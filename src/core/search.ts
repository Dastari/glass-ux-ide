import { alignToCharacter, utf8Length } from "./encoding.ts"
import type { TextSnapshot } from "./document.ts"

const decoder = new TextDecoder("utf-8")

export interface SearchOptions {
  start?: number
  end?: number
  /** Bytes decoded at once. */
  chunkSize?: number
  /** The longest match that is guaranteed to be found across a chunk boundary. */
  maxMatchBytes?: number
  signal?: AbortSignal
  /** Called after each chunk with the offset reached. */
  onProgress?: (offset: number) => void
}

/** A match. Offsets are bytes in the document. */
export interface SearchMatch {
  start: number
  end: number
  text: string
}

/**
 * Finds a pattern through a snapshot in overlapping chunks, in order, holding one chunk at a time.
 * The overlap catches matches that cross a boundary, so `maxMatchBytes` is the limit on match
 * length, which the UI should state.
 */
export async function* search(snapshot: TextSnapshot, pattern: RegExp, options: SearchOptions = {}): AsyncGenerator<SearchMatch> {
  const { start = 0, end = snapshot.size, chunkSize = 4 * 1024 * 1024, maxMatchBytes = 64 * 1024, signal, onProgress } = options
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const expression = new RegExp(pattern.source, flags)
  let at = start
  let reported = start
  while (at < end) {
    signal?.throwIfAborted()
    const stop = Math.min(end, at + chunkSize + maxMatchBytes)
    const bytes = await snapshot.read(at, stop, signal)
    const usable = stop === end ? bytes.length : alignToCharacter(bytes, bytes.length)
    const text = decoder.decode(bytes.subarray(0, usable))
    const ascii = text.length === usable
    // A match starting past the chunk proper belongs to the next read, which sees it whole.
    const boundary = stop === end ? end : at + chunkSize
    expression.lastIndex = 0
    let walked = 0
    let walkedBytes = 0
    for (let match = expression.exec(text); match; match = expression.exec(text)) {
      if (match[0].length === 0) expression.lastIndex += 1
      const from = ascii ? match.index : walkedBytes + utf8Length(text, walked, match.index)
      if (!ascii) {
        walked = match.index
        walkedBytes = from
      }
      const offset = at + from
      if (offset >= boundary) break
      if (offset < reported) continue
      const length = ascii ? match[0].length : utf8Length(match[0])
      reported = offset + Math.max(length, 1)
      yield { start: offset, end: offset + length, text: match[0] }
    }
    onProgress?.(Math.min(end, boundary))
    at = boundary
    // A boundary inside a character would decode as a replacement on both sides.
    if (at < end) {
      const edge = await snapshot.read(Math.max(start, at - 3), Math.min(end, at + 1), signal)
      at = Math.max(start, at - 3) + alignToCharacter(edge, at - Math.max(start, at - 3))
    }
  }
}

/** The last match before an offset, reading backward a chunk at a time. */
export async function searchBackward(snapshot: TextSnapshot, pattern: RegExp, before: number, chunkSize = 1024 * 1024): Promise<SearchMatch | null> {
  for (let end = before; end > 0; end = Math.max(0, end - chunkSize)) {
    const start = Math.max(0, end - chunkSize)
    let last: SearchMatch | null = null
    // Matches are reported whole, so one starting here may run past `end`, which is fine to skip.
    for await (const match of search(snapshot, pattern, { start, end: Math.min(snapshot.size, end + 64 * 1024) })) {
      if (match.start >= end) break
      last = match
    }
    if (last) return last
  }
  return null
}
