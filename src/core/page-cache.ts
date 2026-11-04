import type { ByteSource } from "./types.ts"

/** Reads a source through an LRU of fixed pages, so scrolling back and forth costs no I/O. */
export class PageCache {
  private readonly pages = new Map<number, Uint8Array>()
  private readonly loading = new Map<number, Promise<Uint8Array>>()
  private readonly source: ByteSource
  private readonly capacity: number
  readonly pageSize: number

  constructor(source: ByteSource, pageSize = 64 * 1024, capacityBytes = 128 * 1024 * 1024) {
    this.source = source
    this.pageSize = pageSize
    this.capacity = Math.max(1, Math.floor(capacityBytes / pageSize))
  }

  /** Pages held right now. */
  get size() {
    return this.pages.size
  }

  /** Bytes held right now. */
  get bytes() {
    return this.pages.size * this.pageSize
  }

  /** Returns the bytes of a range. A range within one page shares its memory: do not change it. */
  async read(start: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0)
    const first = Math.floor(start / this.pageSize)
    const last = Math.floor((start + length - 1) / this.pageSize)
    if (first === last) {
      const page = await this.page(first, signal)
      const at = start - first * this.pageSize
      return page.subarray(at, at + length)
    }
    const pending: Promise<Uint8Array>[] = []
    for (let index = first; index <= last; index += 1) pending.push(this.page(index, signal))
    const pages = await Promise.all(pending)
    const result = new Uint8Array(length)
    let written = 0
    pages.forEach((page, position) => {
      const from = position === 0 ? start - first * this.pageSize : 0
      const part = page.subarray(from, Math.min(page.length, from + length - written))
      result.set(part, written)
      written += part.length
    })
    return result
  }

  private async page(index: number, signal?: AbortSignal): Promise<Uint8Array> {
    const held = this.pages.get(index)
    if (held) {
      // A Map iterates in insertion order, so re-inserting marks this page most recently used.
      this.pages.delete(index)
      this.pages.set(index, held)
      return held
    }
    const inFlight = this.loading.get(index)
    if (inFlight) return inFlight
    const start = index * this.pageSize
    const length = Math.min(this.pageSize, this.source.size - start)
    const load = this.source.read(start, length, signal).then((bytes) => {
      this.loading.delete(index)
      this.pages.set(index, bytes)
      if (this.pages.size > this.capacity) this.pages.delete(this.pages.keys().next().value!)
      return bytes
    }, (error: unknown) => {
      this.loading.delete(index)
      throw error
    })
    this.loading.set(index, load)
    return load
  }
}
