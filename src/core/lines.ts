import type { ByteSource } from "./types.ts"

const LF = 10

/**
 * Counts line feeds in `bytes[from, to)`. The range is taken as a view because `indexOf` has no end
 * argument: searching the whole buffer per block goes quadratic on a file with no line feeds.
 */
export function countLineFeeds(bytes: Uint8Array, from = 0, to = bytes.length): number {
  const view = bytes.subarray(from, to)
  let count = 0
  for (let at = view.indexOf(LF); at !== -1; at = view.indexOf(LF, at + 1)) count += 1
  return count
}

/** The offset of line feed number `n` (zero-based) in `bytes`, or -1. */
export function nthLineFeed(bytes: Uint8Array, n: number): number {
  let at = bytes.indexOf(LF)
  for (let seen = 0; seen < n && at !== -1; seen += 1) at = bytes.indexOf(LF, at + 1)
  return at
}

export interface LineIndexOptions {
  /** Bytes between checkpoints. Finding a line reads at most one block. */
  blockSize?: number
  /** Bytes read from the source at once. */
  readSize?: number
  /** Called after each read with bytes indexed so far. */
  onProgress?: (indexed: number, size: number) => void
  signal?: AbortSignal
}

/**
 * Line feed counts for the original file, in checkpoints at fixed byte offsets.
 *
 * Checkpoints sit every 256 KiB of file rather than every N lines, so memory depends only on file
 * size: 8 bytes per block, about 1.5 MB for 48 GB. A file that is one enormous line costs the same
 * as any other, which is the case a per-line index gets wrong.
 */
export class LineIndex {
  readonly blockSize: number
  private readonly source: ByteSource
  private readonly blocks: number
  /** `cumulative[i]` is the line feeds before block `i`. */
  private readonly cumulative: Float64Array
  private filled = 0
  /** Bytes per line in a sample from the start of the file, until indexing has something better. */
  sampledLineLength = 80

  constructor(source: ByteSource, blockSize = 256 * 1024) {
    this.source = source
    this.blockSize = blockSize
    this.blocks = Math.ceil(source.size / blockSize)
    this.cumulative = new Float64Array(this.blocks + 1)
  }

  /** Bytes of the file indexed so far. */
  get indexed() {
    return Math.min(this.filled * this.blockSize, this.source.size)
  }

  get complete() {
    return this.filled >= this.blocks
  }

  /** Line feeds in the whole file. Exact only once complete. */
  get total() {
    return this.cumulative[this.filled]!
  }

  /** Bytes per line in what has been read, for estimating before indexing finishes. */
  get averageLineLength() {
    return this.total > 0 ? this.indexed / this.total : this.sampledLineLength
  }

  /** Memory held by the index. */
  get memoryBytes() {
    return this.cumulative.byteLength
  }

  /** Scans the file from wherever it got to. Safe to abort and call again. */
  async build({ readSize = 16 * 1024 * 1024, onProgress, signal }: Omit<LineIndexOptions, "blockSize"> = {}): Promise<void> {
    const perRead = Math.max(1, Math.floor(readSize / this.blockSize))
    const readFrom = (block: number) => {
      const count = Math.min(perRead, this.blocks - block)
      const start = block * this.blockSize
      return this.source.read(start, Math.min(count * this.blockSize, this.source.size - start), signal)
    }
    // One read stays in flight while the last one is counted, so the disk never sits idle.
    let next = this.complete ? null : readFrom(this.filled)
    while (next) {
      signal?.throwIfAborted()
      const bytes: Uint8Array = await next
      const count = Math.ceil(bytes.length / this.blockSize)
      const after = this.filled + count
      next = after < this.blocks ? readFrom(after) : null
      next?.catch(() => undefined)
      for (let block = 0; block < count; block += 1) {
        const from = block * this.blockSize
        const lf = countLineFeeds(bytes, from, Math.min(from + this.blockSize, bytes.length))
        this.cumulative[this.filled + 1] = this.cumulative[this.filled]! + lf
        this.filled += 1
      }
      onProgress?.(this.indexed, this.source.size)
    }
  }

  /** Line feeds before a block. The block must be indexed. */
  before(block: number): number {
    return this.cumulative[block]!
  }

  /** The block holding line feed number `lf`. The file must be indexed. */
  blockOf(lf: number): number {
    let low = 0
    let high = this.blocks - 1
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.cumulative[middle + 1]! <= lf) low = middle + 1
      else high = middle
    }
    return low
  }
}
