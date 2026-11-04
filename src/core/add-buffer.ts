/**
 * The add buffer: every byte ever inserted, append-only, so an old snapshot's pieces stay valid.
 * Fixed chunks mean appending never copies what is already held.
 */
export class AddBuffer {
  private readonly chunks: Uint8Array[] = []
  private used = 0
  readonly chunkSize: number

  constructor(chunkSize = 1024 * 1024) {
    this.chunkSize = chunkSize
  }

  /** Total bytes appended. */
  get size() {
    return this.used
  }

  /** Appends bytes and returns where they start. */
  append(bytes: Uint8Array): number {
    const start = this.used
    let written = 0
    while (written < bytes.length) {
      const index = Math.floor(this.used / this.chunkSize)
      const chunk = (this.chunks[index] ??= new Uint8Array(this.chunkSize))
      const at = this.used - index * this.chunkSize
      const part = bytes.subarray(written, written + this.chunkSize - at)
      chunk.set(part, at)
      written += part.length
      this.used += part.length
    }
    return start
  }

  /** Copies a range out. */
  read(start: number, length: number): Uint8Array {
    const result = new Uint8Array(length)
    let written = 0
    while (written < length) {
      const position = start + written
      const index = Math.floor(position / this.chunkSize)
      const at = position - index * this.chunkSize
      const part = this.chunks[index]!.subarray(at, Math.min(this.chunkSize, at + length - written))
      result.set(part, written)
      written += part.length
    }
    return result
  }
}
