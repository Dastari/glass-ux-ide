import type { FileProvider, FileStat, FileUri, WriteBase, WriteResult } from "glass-ux/file-provider"
import { SaveConflictError, type DocumentState, type SaveOptions } from "../core/index.ts"
import type { DocumentHandle } from "../core/handle.ts"
import { connectDocument, type ConnectOptions } from "../core/worker.ts"
import { fileSource, fileTarget, toReadable, type FileSaveState } from "./file-source.ts"

/** A document open from a provider, with the file it came from. */
export interface OpenFile {
  handle: DocumentHandle
  stat: FileStat
  /** Saves to the same file. Rejects with `SaveConflictError` if it changed there. */
  save(options?: SaveOptions): Promise<DocumentState>
  /** Saves over whatever the file holds now, after a person chose to. Later saves build on it. */
  overwrite(options?: SaveOptions): Promise<DocumentState>
  /**
   * Writes the text to another file, which this document then belongs to. A conflict comes back as
   * the provider's result, and the document stays with the file it had.
   */
  saveTo(provider: FileProvider, uri: FileUri, base: WriteBase, signal: AbortSignal): Promise<WriteResult>
}

/** Opens a provider's file in a worker. The provider stays here; reads come back through it. */
export async function openFile(worker: Worker, firstProvider: FileProvider, uri: FileUri, options: Omit<ConnectOptions, "read"> = {}): Promise<OpenFile> {
  let provider = firstProvider
  const signal = new AbortController().signal
  const stat = await provider.stat(uri, { signal })
  const source = fileSource(provider, stat)
  const state: FileSaveState = { stat }
  const handle = await connectDocument(worker, { kind: "remote", size: source.size }, { ...options, read: (start, length) => source.read(start, length) })
  return {
    handle,
    get stat() {
      return state.stat
    },
    save: (saveOptions) => handle.save(fileTarget(provider, state), saveOptions),
    async overwrite(saveOptions) {
      state.stat = await provider.stat(uri, { signal })
      return handle.save(fileTarget(provider, state, { overwrite: true }), saveOptions)
    },
    async saveTo(target, to, base, abort) {
      let result: WriteResult | undefined
      try {
        await handle.save({
          async write({ size, stream }) {
            if (!target.write) throw new Error(`${target.label} is read-only.`)
            result = await target.write(to, toReadable(stream()), { base, size, signal: abort })
            if (result.status === "conflict") throw new SaveConflictError(`${to} is already there.`)
            provider = target
            state.stat = result.stat
            return fileSource(target, result.stat)
          },
        })
      } catch (error) {
        if (!(error instanceof SaveConflictError) || !result) throw error
      }
      return result!
    },
  }
}
