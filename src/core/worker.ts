/**
 * The channel between a view and a document in a worker. The worker owns the document; the view
 * asks for rows. Everything crossing is plain data, so no document text is held on the main thread.
 *
 * An application's provider cannot cross, because it is an object of closures, so reads and writes
 * through one come back to the main thread. Built-in sources run in the worker directly.
 */
import { SaveConflictError, TextDocument, type SaveContent, type SaveOptions, type SaveTarget, type TextDocumentOptions } from "./document.ts"
import { localHandle, type DocumentHandle, type DocumentState, type FindProgress, type FindQuery } from "./handle.ts"
import { memorySource, syntheticSource } from "./synthetic.ts"
import type { ByteEdit, ByteSource } from "./types.ts"

/** What a worker opens. `remote` reads through the main thread, for an application's provider. */
export type SourceSpec =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "blob"; blob: Blob }
  | { kind: "synthetic"; size: number; lineLength?: number }
  | { kind: "remote"; size: number }

/** Reads for a `remote` source, on the main thread. */
export type RemoteRead = (start: number, length: number) => Promise<Uint8Array>

type Method = "state" | "rows" | "rowsBefore" | "lineStart" | "lineAt" | "lineStartBefore" | "text" | "positionAt" | "offsetAt" | "edit" | "undo" | "redo" | "findNext" | "findPrevious" | "replaceAll" | "history" | "restoreStep"

/** Main thread to worker. */
type Inbound =
  | { id: number; method: Method | "open" | "save" | "saveChunk" | "count" | "stopCount"; args: unknown[] }
  | { replyTo: number; bytes?: Uint8Array; size?: number; error?: string; conflict?: boolean }

/** Worker to main thread. */
type Outbound =
  | { id: number; result: unknown }
  | { id: number; error: string; conflict?: boolean }
  | { indexed: true }
  | { read: number; start: number; length: number }
  | { write: number; saveId: number; size: number; edits: readonly ByteEdit[] }
  | { counted: number; progress: FindProgress }

interface Port {
  onmessage: ((event: MessageEvent<Inbound>) => void) | null
  postMessage(message: Outbound, transfer?: Transferable[]): void
}

/** Runs the document side of the channel. Call it from a worker's entry module. */
export function serveDocument(port: Port) {
  let handle: DocumentHandle | null = null
  let nextCall = 0
  const waiting = new Map<number, (reply: Extract<Inbound, { replyTo: number }>) => void>()
  const saves = new Map<number, SaveContent>()
  const counts = new Map<number, () => void>()
  const iterators = new Map<number, AsyncIterator<Uint8Array>>()

  const ask = (send: (id: number) => Outbound) =>
    new Promise<Extract<Inbound, { replyTo: number }>>((resolve) => {
      const id = nextCall
      nextCall += 1
      waiting.set(id, resolve)
      port.postMessage(send(id))
    })

  const remoteSource = (size: number): ByteSource => ({
    size,
    async read(start, length) {
      const reply = await ask((read) => ({ read, start, length }))
      if (reply.error) throw new Error(reply.error)
      return reply.bytes!
    },
  })

  const sourceOf = (spec: SourceSpec): ByteSource => {
    if (spec.kind === "bytes") return memorySource(spec.bytes)
    if (spec.kind === "synthetic") return syntheticSource(spec)
    if (spec.kind === "remote") return remoteSource(spec.size)
    const { blob } = spec
    return {
      size: blob.size,
      async read(start, length) {
        return new Uint8Array(await blob.slice(start, start + length).arrayBuffer())
      },
    }
  }

  const remoteTarget = (saveId: number): SaveTarget => ({
    async write(content) {
      saves.set(saveId, content)
      const reply = await ask((write) => ({ write, saveId, size: content.size, edits: content.edits }))
      saves.delete(saveId)
      if (reply.conflict) throw new SaveConflictError(reply.error ?? "The file changed.")
      if (reply.error) throw new Error(reply.error)
      return remoteSource(reply.size!)
    },
  })

  port.onmessage = async ({ data }) => {
    if ("replyTo" in data) {
      const resolve = waiting.get(data.replyTo)
      waiting.delete(data.replyTo)
      resolve?.(data)
      return
    }
    const { id, method, args } = data
    try {
      if (method === "open") {
        const [spec, options] = args as [SourceSpec, TextDocumentOptions | undefined]
        handle = localHandle(TextDocument.open(sourceOf(spec), options))
        handle.onIndexed(() => port.postMessage({ indexed: true }))
        port.postMessage({ id, result: await handle.state() })
        return
      }
      if (!handle) throw new Error("The document is not open.")
      if (method === "save") {
        const [saveId, options] = args as [number, SaveOptions | undefined]
        port.postMessage({ id, result: await handle.save(remoteTarget(saveId), options) })
        return
      }
      if (method === "saveChunk") {
        const [saveId] = args as [number]
        const content = saves.get(saveId)
        if (!content) throw new Error("That save is not running.")
        let iterator = iterators.get(saveId)
        if (!iterator) {
          iterator = content.stream()[Symbol.asyncIterator]()
          iterators.set(saveId, iterator)
        }
        const { value, done } = await iterator.next()
        if (done) iterators.delete(saveId)
        const bytes = value ? value.slice() : null
        port.postMessage({ id, result: bytes }, bytes ? [bytes.buffer] : [])
        return
      }
      if (method === "count") {
        const [query] = args as [FindQuery]
        counts.set(id, handle.countMatches(query, (progress) => {
          port.postMessage({ counted: id, progress })
          if (progress.done) counts.delete(id)
        }))
        return
      }
      if (method === "stopCount") {
        const [countId] = args as [number]
        counts.get(countId)?.()
        counts.delete(countId)
        return
      }
      const call = handle[method] as (...values: unknown[]) => Promise<unknown>
      port.postMessage({ id, result: await call(...args) })
    } catch (error) {
      port.postMessage({ id, error: error instanceof Error ? error.message : String(error), conflict: error instanceof SaveConflictError })
    }
  }
}

export interface ConnectOptions extends Omit<TextDocumentOptions, "onIndexProgress"> {
  /** Serves a `remote` source. */
  read?: RemoteRead
}

/** Opens a document in a worker and returns a handle to it. */
export async function connectDocument(worker: Worker, spec: SourceSpec, { read, ...options }: ConnectOptions = {}): Promise<DocumentHandle> {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const counters = new Map<number, (progress: FindProgress) => void>()
  const targets = new Map<number, SaveTarget>()
  const indexed: (() => void)[] = []
  let done = false
  let nextId = 0
  let serving = read

  const call = <T,>(method: Extract<Inbound, { id: number }>["method"], ...args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage({ id, method, args } satisfies Inbound)
    })

  const reply = (message: Extract<Inbound, { replyTo: number }>, transfer: Transferable[] = []) => worker.postMessage(message, transfer)

  /** Runs a save's write here, pulling the text from the worker a chunk at a time. */
  const runWrite = async (replyTo: number, saveId: number, size: number, edits: readonly ByteEdit[]) => {
    const target = targets.get(saveId)
    try {
      if (!target) throw new Error("That save is not running.")
      const source = await target.write({
        size,
        edits,
        async *stream() {
          for (let chunk = await call<Uint8Array | null>("saveChunk", saveId); chunk; chunk = await call<Uint8Array | null>("saveChunk", saveId)) yield chunk
        },
      })
      serving = (start, length) => source.read(start, length)
      reply({ replyTo, size: source.size })
    } catch (error) {
      reply({ replyTo, error: error instanceof Error ? error.message : String(error), conflict: error instanceof SaveConflictError })
    }
  }

  worker.onmessage = ({ data }: MessageEvent<Outbound>) => {
    if ("indexed" in data) {
      done = true
      for (const listener of indexed.splice(0)) listener()
      return
    }
    if ("read" in data) {
      const { read: replyTo, start, length } = data
      if (!serving) return reply({ replyTo, error: "This document has no source to read from." })
      serving(start, length).then(
        (bytes) => {
          // A page may be cached by the provider, so the worker gets its own copy to keep.
          const copy = bytes.slice()
          reply({ replyTo, bytes: copy }, [copy.buffer])
        },
        (error: unknown) => reply({ replyTo, error: error instanceof Error ? error.message : String(error) }),
      )
      return
    }
    if ("write" in data) {
      void runWrite(data.write, data.saveId, data.size, data.edits)
      return
    }
    if ("counted" in data) {
      counters.get(data.counted)?.(data.progress)
      if (data.progress.done) counters.delete(data.counted)
      return
    }
    const request = pending.get(data.id)
    pending.delete(data.id)
    if ("error" in data) request?.reject(data.conflict ? new SaveConflictError(data.error) : new Error(data.error))
    else request?.resolve(data.result)
  }

  await call<DocumentState>("open", spec, options)
  let nextSave = 0
  return {
    state: () => call("state"),
    rows: (start, count, maxBytes) => call("rows", start, count, maxBytes),
    rowsBefore: (offset, count, maxBytes) => call("rowsBefore", offset, count, maxBytes),
    lineStart: (line) => call("lineStart", line),
    lineAt: (offset) => call("lineAt", offset),
    lineStartBefore: (offset, limit) => call("lineStartBefore", offset, limit),
    text: (start, end) => call("text", start, end),
    positionAt: (offset) => call("positionAt", offset),
    offsetAt: (position) => call("offsetAt", position),
    edit: (edits, editOptions) => call("edit", edits, editOptions),
    undo: () => call("undo"),
    redo: () => call("redo"),
    async save(target, saveOptions) {
      const saveId = nextSave
      nextSave += 1
      targets.set(saveId, target)
      try {
        return await call("save", saveId, saveOptions)
      } finally {
        targets.delete(saveId)
      }
    },
    findNext: (query, from) => call("findNext", query, from),
    findPrevious: (query, before) => call("findPrevious", query, before),
    replaceAll: (query, replacement) => call("replaceAll", query, replacement),
    history: () => call("history"),
    restoreStep: (id) => call("restoreStep", id),
    countMatches(query, listener) {
      const id = nextId
      nextId += 1
      counters.set(id, listener)
      worker.postMessage({ id, method: "count", args: [query] } satisfies Inbound)
      return () => {
        counters.delete(id)
        const stop = nextId
        nextId += 1
        worker.postMessage({ id: stop, method: "stopCount", args: [id] } satisfies Inbound)
      }
    },
    onIndexed(listener) {
      if (done) listener()
      else indexed.push(listener)
    },
  }
}
