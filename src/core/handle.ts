import type { EditOptions, SaveOptions, SaveTarget, TextDocument, TextRow } from "./document.ts"
import type { SearchMatch } from "./search.ts"
import type { Tier } from "./tiers.ts"
import type { ByteEdit, Position } from "./types.ts"

/** What a view needs to know about a document, without holding it. */
export interface DocumentState {
  size: number
  lineCount: number
  exactLines: boolean
  /** Bytes of the original file indexed so far. */
  indexed: number
  version: number
  canUndo: boolean
  canRedo: boolean
  tier: Tier
  /** After a save: the step that was written, which edits made during the write may have moved on from. */
  saved?: number
}

/** One step of a document's history, as plain data. */
export interface HistoryStep {
  id: number
  /** The step this one came from. Null for the text as it was opened. */
  parent: number | null
  label: string | undefined
  /** What kind of edit made it, when the editor said: "typing" or "delete". */
  group: string | undefined
  /** When the step was made or last joined, in epoch milliseconds. */
  at: number
  /** The step the text is at now. */
  current: boolean
}

/** A pattern to find, as plain data so it can cross to a worker. */
export interface FindQuery {
  source: string
  flags: string
}

/** Matches found so far, and whether that is all of them. */
export interface FindProgress {
  count: number
  done: boolean
}

/** An asynchronous view of a document, so it can live in a worker or right here. */
export interface DocumentHandle {
  state(): Promise<DocumentState>
  rows(start: number, count: number, maxBytes: number): Promise<TextRow[]>
  rowsBefore(offset: number, count: number, maxBytes: number): Promise<TextRow[]>
  lineStart(line: number): Promise<number>
  lineAt(offset: number): Promise<number>
  lineStartBefore(offset: number, limit?: number): Promise<number>
  text(start: number, end: number): Promise<string>
  positionAt(offset: number): Promise<Position>
  offsetAt(position: Position): Promise<number>
  edit(edits: readonly ByteEdit[], options?: EditOptions): Promise<DocumentState>
  undo(): Promise<DocumentState>
  redo(): Promise<DocumentState>
  /** Saves through a target, and rejects with `SaveConflictError` if the file changed. */
  save(target: SaveTarget, options?: SaveOptions): Promise<DocumentState>
  /** The first match at or after an offset, wrapping to the start. */
  findNext(query: FindQuery, from: number): Promise<SearchMatch | null>
  /** The last match before an offset, wrapping to the end. */
  findPrevious(query: FindQuery, before: number): Promise<SearchMatch | null>
  /** Counts matches as a stream of progress. Returns a way to stop. */
  countMatches(query: FindQuery, listener: (progress: FindProgress) => void): () => void
  /** Replaces every match in one undo step, up to a limit. Rejects past it, leaving the text alone. */
  replaceAll(query: FindQuery, replacement: string): Promise<DocumentState & { replaced: number }>
  /** Every step of the undo tree, oldest first. */
  history(): Promise<HistoryStep[]>
  /** Moves to any step, including one on another branch. */
  restoreStep(id: number): Promise<DocumentState>
  /** Called when line numbers become exact. */
  onIndexed(listener: () => void): void
}

/** The most matches `replaceAll` will take, so one command cannot produce millions of pieces. */
export const REPLACE_LIMIT = 100_000

function stateOf(doc: TextDocument): DocumentState {
  const snapshot = doc.snapshot()
  return {
    size: snapshot.size,
    lineCount: snapshot.lineCount,
    exactLines: snapshot.exactLines,
    indexed: doc.lineIndex.indexed,
    version: snapshot.version,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    tier: doc.tier,
  }
}

function toPattern({ source, flags }: FindQuery) {
  return new RegExp(source, flags)
}

async function first<T>(items: AsyncGenerator<T>): Promise<T | null> {
  const { value, done } = await items.next()
  await items.return(undefined as never)
  return done ? null : value
}

/** A handle over a document on this thread. Workers use it too, on their side of the channel. */
export function localHandle(doc: TextDocument): DocumentHandle {
  // An edit is queued, so a read must wait for it or it would see the text from before.
  let settled: Promise<unknown> = doc.sampled
  const after = async <T>(read: () => Promise<T>) => {
    await settled
    return read()
  }
  return {
    state: () => after(async () => stateOf(doc)),
    rows: (start, count, maxBytes) => after(() => doc.snapshot().rows(Math.min(start, doc.size), count, { maxBytes })),
    rowsBefore: (offset, count, maxBytes) => after(() => doc.snapshot().rowsBefore(Math.min(offset, doc.size), count, { maxBytes })),
    lineStart: (line) => after(() => doc.snapshot().lineStart(line)),
    lineAt: (offset) => after(() => doc.snapshot().lineAt(Math.min(offset, doc.size))),
    lineStartBefore: (offset, limit) => after(() => doc.snapshot().lineStartBefore(Math.min(offset, doc.size), limit)),
    text: (start, end) => after(() => doc.snapshot().text(start, Math.min(end, doc.size))),
    positionAt: (offset) => after(() => doc.snapshot().positionAt(Math.min(offset, doc.size))),
    offsetAt: (position) => after(() => doc.snapshot().offsetAt(position)),
    edit(edits, options) {
      const run = doc.edit(edits, options).then(() => stateOf(doc))
      settled = run.catch(() => undefined)
      return run
    },
    history: () =>
      after(async () => {
        const current = doc.current
        return doc.history().map((entry) => ({ id: entry.id, parent: entry.parent?.id ?? null, label: entry.label, group: entry.group, at: entry.at, current: entry === current }))
      }),
    restoreStep(id) {
      const entry = doc.history().find((item) => item.id === id)
      if (!entry) return Promise.reject(new RangeError(`There is no history step ${id}.`))
      const run = doc.restore(entry).then(() => stateOf(doc))
      settled = run.catch(() => undefined)
      return run
    },
    undo() {
      const run = doc.undo().then(() => stateOf(doc))
      settled = run
      return run
    },
    redo() {
      const run = doc.redo().then(() => stateOf(doc))
      settled = run
      return run
    },
    save(target, options) {
      return doc.save(target, options).then((saved) => ({ ...stateOf(doc), saved }))
    },
    findNext: (query, from) =>
      after(async () => {
        const snapshot = doc.snapshot()
        return (await first(snapshot.search(toPattern(query), { start: Math.min(from, snapshot.size) }))) ?? (await first(snapshot.search(toPattern(query), { end: Math.min(from, snapshot.size) })))
      }),
    findPrevious: (query, before) =>
      after(async () => {
        const snapshot = doc.snapshot()
        return (await snapshot.searchBackward(toPattern(query), Math.min(before, snapshot.size))) ?? (await snapshot.searchBackward(toPattern(query), snapshot.size))
      }),
    countMatches(query, listener) {
      const controller = new AbortController()
      void after(async () => {
        let count = 0
        let reported = performance.now()
        for await (const _ of doc.snapshot().search(toPattern(query), { signal: controller.signal })) {
          count += 1
          if (performance.now() - reported > 100) {
            reported = performance.now()
            listener({ count, done: false })
          }
        }
        listener({ count, done: true })
      }).catch(() => undefined)
      return () => controller.abort()
    },
    replaceAll: (query, replacement) =>
      after(async () => {
        const edits: ByteEdit[] = []
        for await (const match of doc.snapshot().search(toPattern(query))) {
          edits.push({ start: match.start, end: match.end, text: replacement })
          if (edits.length > REPLACE_LIMIT) throw new Error(`More than ${REPLACE_LIMIT} matches. Narrow the search.`)
        }
        if (edits.length) await doc.edit(edits, { label: "Replace all" })
        return { ...stateOf(doc), replaced: edits.length }
      }),
    onIndexed(listener) {
      void doc.indexed.then(listener, () => undefined)
    },
  }
}
