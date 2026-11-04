import { AddBuffer } from "./add-buffer.ts"
import { alignToCharacter, byteLengthOfUnits, utf16Length } from "./encoding.ts"
import { countLineFeeds, LineIndex, nthLineFeed } from "./lines.ts"
import { PageCache } from "./page-cache.ts"
import {
  ADDED,
  concat,
  toPieces,
  mapPieces,
  findLineFeed,
  findPiece,
  forEachPiece,
  fromPieces,
  join,
  lastPiece,
  ORIGINAL,
  removeLast,
  resolveLineFeeds,
  split,
  type Piece,
  type PieceNode,
  type PieceTree,
} from "./piece-tree.ts"
import { search, searchBackward, type SearchMatch, type SearchOptions } from "./search.ts"
import { tierOf, type Tier } from "./tiers.ts"
import { TextRangeError, type ByteEdit, type ByteSource, type Position } from "./types.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8")

/** The largest range `read` will return. Beyond this, use `stream`. */
const MAX_READ = 256 * 1024 * 1024
const SCAN_STEP = 64 * 1024
const COLUMN_STEP = 1024 * 1024
const COPY_STEP = 1024 * 1024

/** A range of the old file that the saved text keeps, and where it landed in the new file. */
interface Survivor {
  start: number
  end: number
  offset: number
}

/** A range of the old file only history uses, and where it was copied in the add buffer. */
interface Orphan {
  start: number
  end: number
  added: number
}

/** The span holding an offset, by binary search over sorted spans that do not overlap. */
function spanHolding<T extends { start: number; end: number }>(spans: readonly T[], offset: number): T | undefined {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (spans[middle]!.end <= offset) low = middle + 1
    else high = middle
  }
  const span = spans[low]
  return span && span.start <= offset ? span : undefined
}
const ROW_WINDOW = 2048

function joinBytes(first: Uint8Array, second: Uint8Array) {
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first)
  joined.set(second, first.length)
  return joined
}

export interface TextDocumentOptions {
  /** Bytes between line index checkpoints. */
  blockSize?: number
  /** Bytes of original file kept in memory. */
  cacheBytes?: number
  /** Size of a cached page. */
  pageSize?: number
  /** Called as the line index advances. */
  onIndexProgress?: (indexed: number, size: number) => void
  /** Build the line index on open. Default true. */
  index?: boolean
}

/** What a save hands to its target. Use whichever suits: `edits` is far smaller for a huge file. */
export interface SaveContent {
  size: number
  /** The whole document. */
  stream(): AsyncIterable<Uint8Array>
  /** The changes from the file as opened, in order, ready for an in-place update. */
  edits: readonly ByteEdit[]
}

/**
 * Where a save goes. The write is one step and may take a long time, so it runs alongside editing.
 * Resolve with the new file's source, or reject with `SaveConflictError` to leave everything as it
 * was. The old file must stay readable until the write finishes.
 */
export interface SaveTarget {
  write(content: SaveContent): Promise<ByteSource>
}

/** The file changed since it was opened. Nothing was written, and the edits are safe. */
export class SaveConflictError extends Error {
  override name = "SaveConflictError"
}

export interface SaveOptions {
  /**
   * The most bytes to copy out of the old file to keep undo working. They exist only in history,
   * and will not be in the new file. Default 256 MB.
   */
  maxHistoryBytes?: number
  /** Save anyway when history would need more than that, discarding undo past this save. */
  dropHistory?: boolean
}

/** A save would lose history. Ask the person, then retry with `dropHistory`. */
export class HistoryTooLargeError extends Error {
  override name = "HistoryTooLargeError"
  /** Bytes of old text that history depends on. */
  readonly bytes: number

  constructor(bytes: number) {
    super(`Keeping undo past this save needs ${bytes} bytes of old text.`)
    this.bytes = bytes
  }
}

/** A snapshot from before a save: the file its pieces point at has been replaced. */
export class StaleSnapshotError extends Error {
  override name = "StaleSnapshotError"
}

export interface EditOptions {
  /** Consecutive edits with the same group merge into one undo step while they keep coming. */
  group?: string
  /** Names the step in history. */
  label?: string
  /**
   * Joins the current step instead of starting one, whatever the time since it. Replaying a
   * journal uses it to rebuild the same steps the edits made the first time.
   */
  join?: boolean
}

/** One step on the undo tree. Typing after an undo starts a branch; the old branch stays. */
export interface HistoryEntry {
  readonly id: number
  readonly parent: HistoryEntry | null
  readonly children: HistoryEntry[]
  readonly label: string | undefined
  root: PieceTree
  at: number
  group: string | undefined
}

/** A row of text, ready to draw. Offsets are bytes in the document. */
export interface TextRow {
  start: number
  /** End of the row's text, before any line ending. */
  end: number
  /** Where the next row starts. */
  next: number
  text: string
  /** The row stopped at the size limit, and its line carries on in the next row. */
  continues: boolean
}

const GROUP_WINDOW = 1000

/**
 * A document of any size. It owns the piece tree and hands out immutable snapshots, so reading,
 * searching and saving never block editing. Bytes are read on demand; nothing here holds the
 * whole file, and nothing turns it into one string.
 */
export class TextDocument {
  source: ByteSource
  readonly add = new AddBuffer()
  cache: PageCache
  lineIndex: LineIndex
  /** Settles when the line index is complete and every snapshot has exact line numbers. */
  indexed: Promise<void>
  /** Settles once a sample has set the line estimate, which is quick: it reads one page. */
  sampled: Promise<void> = Promise.resolve()
  /** Counts saves. A snapshot belongs to one file, so it stops working when that file is replaced. */
  generation = 0

  private head: HistoryEntry
  private readonly start: HistoryEntry
  private nextEntry = 1
  private queue: Promise<unknown> = Promise.resolve()
  private abort = new AbortController()
  private readonly options: TextDocumentOptions

  private constructor(source: ByteSource, options: TextDocumentOptions) {
    this.source = source
    this.options = options
    this.cache = new PageCache(source, options.pageSize, options.cacheBytes)
    this.lineIndex = new LineIndex(source, options.blockSize)
    const root = source.size ? fromPieces([{ source: ORIGINAL, start: 0, length: source.size, lf: Number.NaN }]) : null
    this.start = { id: 0, parent: null, children: [], label: undefined, root, at: Date.now(), group: undefined }
    this.head = this.start
    this.indexed = options.index === false ? Promise.resolve() : this.buildIndex(options)
    this.sampled = this.sample()
  }

  /** Estimates line length from the start of the file, so an unindexed line count is reasonable. */
  private async sample() {
    const length = Math.min(this.source.size, this.cache.pageSize)
    if (length === 0) return
    const lf = countLineFeeds(await this.cache.read(0, length))
    if (lf > 0) this.lineIndex.sampledLineLength = length / lf
  }

  /** Opens a document over a source. Returns at once; line numbers are estimates until `indexed`. */
  static open(source: ByteSource, options: TextDocumentOptions = {}): TextDocument {
    return new TextDocument(source, options)
  }

  /** The current document's size in bytes. */
  get size() {
    return this.head.root?.bytes ?? 0
  }

  /** The feature budget for the original file's size. */
  get tier(): Tier {
    return tierOf(this.source.size)
  }

  /** The current history step. */
  get current(): HistoryEntry {
    return this.head
  }

  get canUndo() {
    return this.head.parent !== null
  }

  get canRedo() {
    return this.head.children.length > 0
  }

  /** The current text. It stays valid and unchanged whatever happens to the document afterwards. */
  snapshot(): TextSnapshot {
    return new TextSnapshot(this, this.head.root, this.head.id)
  }

  /** A snapshot of any history step. */
  snapshotOf(entry: HistoryEntry): TextSnapshot {
    return new TextSnapshot(this, entry.root, entry.id)
  }

  /**
   * Applies edits as one step. Offsets all refer to the document as it stands, so they must not
   * overlap. Edits queue, so they apply in the order they were made.
   */
  edit(edits: readonly ByteEdit[], options: EditOptions = {}): Promise<HistoryEntry> {
    return this.enqueue(async () => {
      const ordered = [...edits].sort((a, b) => b.start - a.start)
      let root = this.head.root
      let limit = root?.bytes ?? 0
      for (const edit of ordered) {
        if (edit.start < 0 || edit.end < edit.start || edit.end > limit) {
          throw new TextRangeError(`Edit ${edit.start}–${edit.end} is outside the document or overlaps another.`)
        }
        limit = edit.start
        root = await this.apply(root, edit)
      }
      return this.commit(root, options)
    })
  }

  /** Moves to the previous step. Returns false at the start. */
  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.head.parent) return false
      this.head = this.head.parent
      return true
    })
  }

  /** Moves forward on the most recent branch. Returns false at the end. */
  redo(): Promise<boolean> {
    return this.enqueue(async () => {
      const next = this.head.children[this.head.children.length - 1]
      if (!next) return false
      this.head = next
      return true
    })
  }

  /** Moves to any step, including one on another branch. */
  restore(entry: HistoryEntry): Promise<void> {
    return this.enqueue(async () => {
      this.head = entry
    })
  }

  /** Every history step, oldest first. */
  history(): HistoryEntry[] {
    const entries: HistoryEntry[] = []
    const walk = (entry: HistoryEntry) => {
      entries.push(entry)
      entry.children.forEach(walk)
    }
    walk(this.start)
    return entries.sort((a, b) => a.id - b.id)
  }

  /**
   * Saves the current text. The write runs outside the edit queue, from a snapshot, so a person
   * can keep typing through a long save; anything typed meanwhile stays unsaved.
   *
   * Replacing the file would strand undo, because old pieces point into it. So first, while the
   * old file is still there, text that only history uses is copied into the add buffer. The cost
   * is that text, not the file's size. When the write finishes, every step's pieces are moved
   * onto the new file. If the write fails, the copy is simply unused and nothing else has changed.
   */
  async save(target: SaveTarget, { maxHistoryBytes = 256 * 1024 * 1024, dropHistory = false }: SaveOptions = {}): Promise<void> {
    const { saved, survivors, orphans, content } = await this.enqueue(async () => {
      const entry = this.head
      const pieces = toPieces(entry.root)
      const kept: Survivor[] = []
      let offset = 0
      for (const piece of pieces) {
        if (piece.source === ORIGINAL) kept.push({ start: piece.start, end: piece.start + piece.length, offset })
        offset += piece.length
      }
      kept.sort((a, b) => a.start - b.start)
      const missing = dropHistory ? [] : this.rangesOnlyHistoryUses(kept)
      const bytes = missing.reduce((sum, range) => sum + range.end - range.start, 0)
      if (bytes > maxHistoryBytes) throw new HistoryTooLargeError(bytes)
      const copied: Orphan[] = []
      for (const range of missing) {
        const added = this.add.size
        for (let from = range.start; from < range.end; from += COPY_STEP) {
          this.add.append(await this.cache.read(from, Math.min(COPY_STEP, range.end - from)))
        }
        copied.push({ ...range, added })
      }
      const snapshot = this.snapshotOf(entry)
      return {
        saved: entry,
        survivors: kept,
        orphans: copied,
        content: { size: snapshot.size, stream: () => snapshot.stream(), edits: this.editsFromOriginal(pieces) },
      }
    })
    const source = await target.write(content)
    await this.enqueue(async () => {
      if (dropHistory) this.forgetHistory(saved)
      const memo = new WeakMap<PieceNode, PieceTree>()
      for (const entry of this.history()) {
        entry.root = mapPieces(entry.root, (piece) => (piece.source === ORIGINAL ? this.relocate(piece, survivors, orphans) : [piece]), memo)
      }
      this.adopt(source)
    })
  }

  /** Stops background work. Reads already made keep working. */
  dispose() {
    this.abort.abort()
  }

  /** The changes from the original file to these pieces. */
  private editsFromOriginal(pieces: readonly Piece[]): ByteEdit[] {
    const edits: ByteEdit[] = []
    let cursor = 0
    let pending: Uint8Array[] = []
    const flush = (end: number) => {
      if (end === cursor && pending.length === 0) return
      const length = pending.reduce((sum, part) => sum + part.length, 0)
      const text = new Uint8Array(length)
      let at = 0
      for (const part of pending) {
        text.set(part, at)
        at += part.length
      }
      edits.push({ start: cursor, end, text })
      pending = []
    }
    // Original bytes keep their relative order in every step: moving text makes it added text.
    for (const piece of pieces) {
      if (piece.source === ADDED) pending.push(this.add.read(piece.start, piece.length))
      else {
        flush(piece.start)
        cursor = piece.start + piece.length
      }
    }
    flush(this.source.size)
    return edits
  }

  /** Ranges of the old file that history uses and the saved text does not, sorted. */
  private rangesOnlyHistoryUses(survivors: readonly Survivor[]): { start: number; end: number }[] {
    const used: { start: number; end: number }[] = []
    const visited = new Set<PieceNode>()
    const collect = (node: PieceTree) => {
      if (!node || visited.has(node)) return
      visited.add(node)
      collect(node.left)
      if (node.piece.source === ORIGINAL) used.push({ start: node.piece.start, end: node.piece.start + node.piece.length })
      collect(node.right)
    }
    for (const entry of this.history()) collect(entry.root)
    used.sort((a, b) => a.start - b.start)
    const missing: { start: number; end: number }[] = []
    const add = (start: number, end: number) => {
      const last = missing[missing.length - 1]
      if (last && start <= last.end) last.end = Math.max(last.end, end)
      else missing.push({ start, end })
    }
    let survivor = 0
    let covered = 0
    for (const range of used) {
      let at = Math.max(range.start, covered)
      while (at < range.end) {
        while (survivor < survivors.length && survivors[survivor]!.end <= at) survivor += 1
        const next = survivors[survivor]
        if (!next || next.start >= range.end) {
          add(at, range.end)
          at = range.end
        } else {
          if (next.start > at) add(at, next.start)
          at = Math.min(range.end, next.end)
        }
      }
      covered = Math.max(covered, range.end)
    }
    return missing
  }

  /** Rewrites one old-file piece in terms of the new file and the add buffer. */
  private relocate(piece: Piece, survivors: readonly Survivor[], orphans: readonly Orphan[]): Piece[] {
    const result: Piece[] = []
    const end = piece.start + piece.length
    for (let at = piece.start; at < end; ) {
      const survivor = spanHolding(survivors, at)
      if (survivor) {
        const stop = Math.min(end, survivor.end)
        const whole = at === piece.start && stop === end
        result.push({ source: ORIGINAL, start: survivor.offset + (at - survivor.start), length: stop - at, lf: whole ? piece.lf : Number.NaN })
        at = stop
        continue
      }
      const orphan = spanHolding(orphans, at)
      if (!orphan) throw new Error(`Nothing holds byte ${at} of the old file.`)
      const stop = Math.min(end, orphan.end)
      const start = orphan.added + (at - orphan.start)
      result.push({ source: ADDED, start, length: stop - at, lf: countLineFeeds(this.add.read(start, stop - at)) })
      at = stop
    }
    return result
  }

  /** Drops every step except the saved one and what came after it. */
  private forgetHistory(saved: HistoryEntry) {
    const descends = (entry: HistoryEntry | null): boolean => entry === saved || (entry ? descends(entry.parent) : false)
    if (!descends(this.head)) this.head = saved
    if (saved === this.start) return
    this.start.children.length = 0
    this.start.children.push(...saved.children)
    for (const child of saved.children) (child as { parent: HistoryEntry | null }).parent = this.start
    this.start.root = saved.root
    if (this.head === saved) this.head = this.start
  }

  /** Moves onto the new file: fresh cache, fresh index, and old snapshots no longer valid. */
  private adopt(source: ByteSource) {
    this.abort.abort()
    this.abort = new AbortController()
    this.generation += 1
    this.source = source
    this.cache = new PageCache(source, this.options.pageSize, this.options.cacheBytes)
    this.lineIndex = new LineIndex(source, this.options.blockSize)
    this.indexed = this.options.index === false ? Promise.resolve() : this.buildIndex(this.options)
    this.sampled = this.sample()
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  private commit(root: PieceTree, { group, label, join }: EditOptions): HistoryEntry {
    const now = Date.now()
    const head = this.head
    if (join && head.parent ? true : group && head.group === group && head.parent && head.children.length === 0 && now - head.at < GROUP_WINDOW) {
      head.root = root
      head.at = now
      return head
    }
    const entry: HistoryEntry = { id: this.nextEntry, parent: head, children: [], label, root, at: now, group }
    this.nextEntry += 1
    head.children.push(entry)
    this.head = entry
    return entry
  }

  private async apply(root: PieceTree, edit: ByteEdit): Promise<PieceTree> {
    const [low, rest] = await this.splitAt(root, edit.start)
    const [, high] = await this.splitAt(rest, edit.end - edit.start)
    const bytes = typeof edit.text === "string" ? encoder.encode(edit.text) : edit.text
    if (bytes.length === 0) return concat(low, high)
    const start = this.add.append(bytes)
    const lf = countLineFeeds(bytes)
    const last = lastPiece(low)
    if (low && last?.source === ADDED && last.start + last.length === start) {
      // Typing is contiguous in the add buffer, so a burst stays one piece, not one per key.
      const [rest, previous] = removeLast(low)
      return join(rest, { source: ADDED, start: previous.start, length: previous.length + bytes.length, lf: previous.lf + lf }, high)
    }
    return join(low, { source: ADDED, start, length: bytes.length, lf }, high)
  }

  private async splitAt(root: PieceTree, offset: number): Promise<[PieceTree, PieceTree]> {
    const found = findPiece(root, offset)
    const lfBefore = found && found.pieceOffset > 0 ? await this.countInPiece(found.piece, found.pieceOffset) : 0
    return split(root, offset, lfBefore)
  }

  /** Line feeds in the first `length` bytes of a piece, or NaN before the index knows. */
  async countInPiece(piece: Piece, length: number): Promise<number> {
    if (piece.source === ADDED) {
      // Count the shorter side: a large paste is split as often as a small one.
      if (!Number.isNaN(piece.lf) && length > piece.length / 2) {
        const tail = this.add.read(piece.start + length, piece.length - length)
        return piece.lf - countLineFeeds(tail)
      }
      return countLineFeeds(this.add.read(piece.start, length))
    }
    if (!this.lineIndex.complete) return Number.NaN
    return (await this.originalBefore(piece.start + length)) - (await this.originalBefore(piece.start))
  }

  /** Line feeds in the original file before an offset. Reads at most one block. */
  private async originalBefore(offset: number): Promise<number> {
    const block = Math.floor(offset / this.lineIndex.blockSize)
    const blockStart = block * this.lineIndex.blockSize
    const within = offset - blockStart
    if (within === 0) return this.lineIndex.before(block)
    const bytes = await this.cache.read(blockStart, within)
    return this.lineIndex.before(block) + countLineFeeds(bytes)
  }

  /** The position within a piece of its line feed number `n`. */
  async lineFeedInPiece(piece: Piece, n: number): Promise<number> {
    if (piece.source === ADDED) return nthLineFeed(this.add.read(piece.start, piece.length), n)
    const target = (await this.originalBefore(piece.start)) + n
    const block = this.lineIndex.blockOf(target)
    const blockStart = block * this.lineIndex.blockSize
    const length = Math.min(this.lineIndex.blockSize, this.source.size - blockStart)
    const bytes = await this.cache.read(blockStart, length)
    return blockStart + nthLineFeed(bytes, target - this.lineIndex.before(block)) - piece.start
  }

  private async buildIndex(options: TextDocumentOptions): Promise<void> {
    const { signal } = this.abort
    try {
      await this.lineIndex.build({ onProgress: options.onIndexProgress, signal })
    } catch (error) {
      if (signal.aborted) return
      throw error
    }
    await this.enqueue(() => this.resolveHistory())
  }

  /** Fills in line counts everywhere, keeping history's shared structure shared. */
  private async resolveHistory(): Promise<void> {
    const entries = this.history()
    const counts = new Map<string, number>()
    const collect = (node: PieceTree, visited: Set<PieceNode>) => {
      if (!node || node.unknownBytes === 0 || visited.has(node)) return
      visited.add(node)
      collect(node.left, visited)
      if (Number.isNaN(node.piece.lf)) counts.set(`${node.piece.start}:${node.piece.length}`, 0)
      collect(node.right, visited)
    }
    const visited = new Set<PieceNode>()
    for (const entry of entries) collect(entry.root, visited)
    for (const key of counts.keys()) {
      const [start, length] = key.split(":").map(Number) as [number, number]
      counts.set(key, await this.countInPiece({ source: ORIGINAL, start, length, lf: Number.NaN }, length))
    }
    const memo = new WeakMap<PieceNode, PieceNode>()
    for (const entry of entries) {
      entry.root = resolveLineFeeds(entry.root, (piece) => counts.get(`${piece.start}:${piece.length}`)!, memo)
    }
  }
}

/**
 * The document at one moment. It never changes, even while the document is being edited, so
 * anything slow can work from it. Line numbers are estimates until the line index completes, and
 * byte offsets are always exact: `exactLines` says which you have.
 */
export class TextSnapshot {
  private readonly document: TextDocument
  private readonly root: PieceTree
  private readonly generation: number
  /** The history step this snapshot came from. */
  readonly version: number

  constructor(owner: TextDocument, root: PieceTree, version: number) {
    this.document = owner
    this.root = root
    this.version = version
    this.generation = owner.generation
  }

  get size() {
    return this.root?.bytes ?? 0
  }

  /** Pieces in the tree: a measure of how fragmented the edits have left it. */
  get pieces() {
    return this.root?.pieces ?? 0
  }

  /** Whether line numbers are exact. */
  get exactLines() {
    return !this.root || this.root.unknownBytes === 0
  }

  /** Lines in the document, exact or estimated. A trailing line feed starts an empty last line. */
  get lineCount() {
    const known = this.root?.lf ?? 0
    const unknown = this.root?.unknownBytes ?? 0
    return known + 1 + Math.round(unknown / this.document.lineIndex.averageLineLength)
  }

  /** Reads a byte range. For long ranges use `stream`. */
  async read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
    this.check(start, end)
    if (this.generation !== this.document.generation) throw new StaleSnapshotError("The file this snapshot read from has been replaced by a save.")
    const length = end - start
    if (length > MAX_READ) throw new TextRangeError(`Reading ${length} bytes at once is not supported. Use stream().`)
    const parts: Promise<Uint8Array>[] = []
    forEachPiece(this.root, start, end, (piece, offset) => {
      const from = Math.max(start, offset) - offset
      const to = Math.min(end, offset + piece.length) - offset
      if (piece.source === ADDED) parts.push(Promise.resolve(this.document.add.read(piece.start + from, to - from)))
      else parts.push(this.document.cache.read(piece.start + from, to - from, signal))
    })
    const chunks = await Promise.all(parts)
    if (chunks.length === 1) return chunks[0]!
    const result = new Uint8Array(length)
    let written = 0
    for (const chunk of chunks) {
      result.set(chunk, written)
      written += chunk.length
    }
    return result
  }

  /** Reads a range as text. The range should fall on character boundaries. */
  async text(start = 0, end = this.size, signal?: AbortSignal): Promise<string> {
    return decoder.decode(await this.read(start, end, signal))
  }

  /** Streams the bytes of a range, in order. This is how a large document leaves the engine. */
  async *stream(start = 0, end = this.size, chunkSize = 1024 * 1024, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    this.check(start, end)
    for (let at = start; at < end; at += chunkSize) {
      signal?.throwIfAborted()
      yield await this.read(at, Math.min(end, at + chunkSize), signal)
    }
  }

  /** The line holding a byte offset. An estimate unless `exactLines`. */
  async lineAt(offset: number): Promise<number> {
    this.check(offset, offset)
    if (!this.exactLines) return Math.floor((offset / Math.max(1, this.size)) * (this.lineCount - 1))
    const found = findPiece(this.root, offset)
    if (!found) return this.root?.lf ?? 0
    if (found.pieceOffset === 0) return found.lfBefore
    return found.lfBefore + (await this.document.countInPiece(found.piece, found.pieceOffset))
  }

  /** The byte offset where a line starts. Needs exact lines; before that, scroll by byte offset. */
  async lineStart(line: number): Promise<number> {
    if (!this.exactLines) throw new TextRangeError("Line numbers are not known until indexing finishes. Use byte offsets.")
    if (line <= 0) return 0
    const found = findLineFeed(this.root, line - 1)
    if (!found) return this.size
    return found.before + (await this.document.lineFeedInPiece(found.piece, line - 1 - found.lfBefore)) + 1
  }

  /** The start of the line holding `offset`, found by scanning back. Works before indexing. */
  async lineStartBefore(offset: number, limit = 1024 * 1024): Promise<number> {
    this.check(offset, offset)
    const floor = Math.max(0, offset - limit)
    let end = offset
    while (end > floor) {
      const start = Math.max(floor, end - SCAN_STEP)
      const bytes = await this.read(start, end)
      const at = bytes.lastIndexOf(10)
      if (at !== -1) return start + at + 1
      end = start
    }
    return floor
  }

  /**
   * Reads rows forward from a byte offset. A line longer than `maxBytes` comes back as several
   * rows, so one enormous line cannot produce an enormous string.
   */
  async rows(start: number, count: number, { maxBytes = 64 * 1024, signal }: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<TextRow[]> {
    this.check(start, start)
    const rows: TextRow[] = []
    let offset = start
    while (rows.length < count) {
      const row = await this.row(offset, maxBytes, signal)
      rows.push(row)
      if (row.next >= this.size && row.next === row.end) break
      offset = row.next
    }
    return rows
  }

  /** Reads up to `count` rows ending just before a byte offset, for scrolling upward. */
  async rowsBefore(offset: number, count: number, { maxBytes = 64 * 1024, signal }: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<TextRow[]> {
    this.check(offset, offset)
    const collected: TextRow[] = []
    let from = offset
    while (collected.length < count && from > 0) {
      const start = await this.rowFloor(from, maxBytes * (count - collected.length + 1))
      const rows: TextRow[] = []
      for (let at = start; at < from; ) {
        const row = await this.row(at, maxBytes, signal)
        rows.push(row)
        if (row.next <= at) break
        at = row.next
      }
      collected.unshift(...rows)
      from = start
    }
    return collected.slice(-count)
  }

  /** The start of the line before `offset`, or a character boundary `limit` back in a long line. */
  private async rowFloor(offset: number, limit: number): Promise<number> {
    const start = await this.lineStartBefore(Math.max(0, offset - 1), limit)
    if (start === 0) return 0
    const bytes = await this.read(start - 1, Math.min(this.size, start + 4))
    if (bytes[0] === 10) return start
    let skip = 1
    while (skip < bytes.length && (bytes[skip]! & 0xc0) === 0x80) skip += 1
    return start - 1 + skip
  }

  private async row(start: number, maxBytes: number, signal?: AbortSignal): Promise<TextRow> {
    const limit = Math.min(this.size, start + maxBytes)
    // One byte past the limit: a line of exactly maxBytes must end here, not spill an empty row.
    const scanEnd = Math.min(this.size, limit + 1)
    // Lines are usually short, so look a little way ahead first and widen only if needed.
    let window = ROW_WINDOW
    let held: Uint8Array = new Uint8Array(0)
    let lineEnd = -1
    for (let end = Math.min(scanEnd, start + window); ; end = Math.min(scanEnd, start + window)) {
      const from = start + held.length
      const part = await this.read(from, end, signal)
      const at = part.indexOf(10)
      if (at !== -1) lineEnd = from + at
      held = held.length ? joinBytes(held, part) : part
      if (lineEnd !== -1 || end === scanEnd) break
      window *= 4
    }
    if (lineEnd !== -1) {
      const bytes = held.subarray(0, lineEnd - start)
      const end = bytes[bytes.length - 1] === 13 ? lineEnd - 1 : lineEnd
      return { start, end, next: lineEnd + 1, text: decoder.decode(bytes.subarray(0, end - start)), continues: false }
    }
    const bytes = held.subarray(0, limit - start)
    if (limit === this.size) return { start, end: limit, next: limit, text: decoder.decode(bytes), continues: false }
    const end = start + alignToCharacter(bytes, bytes.length)
    return { start, end, next: end, text: decoder.decode(bytes.subarray(0, end - start)), continues: true }
  }

  /** The line and UTF-16 column of a byte offset. */
  async positionAt(offset: number): Promise<Position> {
    const line = await this.lineAt(offset)
    const start = this.exactLines ? await this.lineStart(line) : await this.lineStartBefore(offset)
    let column = 0
    for await (const chunk of this.stream(start, offset, COLUMN_STEP)) column += utf16Length(chunk)
    return { line, column }
  }

  /** The byte offset of a line and UTF-16 column, clamped to the end of the line. */
  async offsetAt({ line, column }: Position): Promise<number> {
    const start = await this.lineStart(line)
    const next = line + 1 < this.lineCount ? await this.lineStart(line + 1) : this.size
    let offset = start
    let left = column
    while (left > 0 && offset < next) {
      const bytes = await this.read(offset, Math.min(next, offset + COLUMN_STEP))
      const step = byteLengthOfUnits(bytes, left)
      offset += step.bytes
      left -= step.units
    }
    if (offset >= next && next > start && line + 1 < this.lineCount) {
      const last = await this.read(next - 1, next)
      if (last[0] === 10) return next - 1
    }
    return offset
  }

  /** Finds a pattern, streaming matches in order. Works at any size, and before indexing. */
  search(pattern: RegExp, options?: SearchOptions): AsyncGenerator<SearchMatch> {
    return search(this, pattern, options)
  }

  /** The last match before an offset. */
  searchBackward(pattern: RegExp, before: number): Promise<SearchMatch | null> {
    return searchBackward(this, pattern, before)
  }

  private check(start: number, end: number) {
    if (start < 0 || end < start || end > this.size) {
      throw new TextRangeError(`Range ${start}–${end} is outside the document (${this.size} bytes).`)
    }
  }
}

