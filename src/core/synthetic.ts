import type { ByteSource } from "./types.ts"

const HEX = "0123456789abcdef"
const ZERO = 48

/**
 * A deterministic file of any size, generated on demand. Line N is the same bytes every time and
 * can be produced directly, so tests and demos get a 100 GB file without storing one.
 */
export function syntheticSource({ size, lineLength = 128 }: { size: number; lineLength?: number }): ByteSource {
  const prefix = new TextEncoder().encode('{"line":')
  const middle = new TextEncoder().encode(',"trace":"')
  const suffix = new TextEncoder().encode('","pad":"')
  const tail = new TextEncoder().encode('"}')
  const digits = 13
  const fixed = prefix.length + digits + middle.length + 8 + suffix.length + tail.length + 1
  if (lineLength < fixed) throw new Error(`lineLength must be at least ${fixed}`)
  const template = new Uint8Array(lineLength).fill(46)
  let at = 0
  template.set(prefix, at)
  at += prefix.length
  const digitsAt = at
  at += digits
  template.set(middle, at)
  at += middle.length
  const traceAt = at
  at += 8
  template.set(suffix, at)
  template.set(tail, lineLength - 1 - tail.length)
  template[lineLength - 1] = 10

  const line = new Uint8Array(lineLength)
  const render = (index: number) => {
    line.set(template)
    let rest = index
    for (let place = digits - 1; place >= 0; place -= 1) {
      line[digitsAt + place] = ZERO + rest % 10
      rest = Math.floor(rest / 10)
    }
    let hash = Math.imul((index % 4294967296) ^ 0x9e3779b9, 0x85ebca6b) >>> 0
    for (let place = 7; place >= 0; place -= 1) {
      line[traceAt + place] = HEX.charCodeAt(hash & 15)
      hash >>>= 4
    }
    return line
  }

  return {
    size,
    async read(start, length) {
      const bytes = new Uint8Array(length)
      let written = 0
      let index = Math.floor(start / lineLength)
      let from = start - index * lineLength
      while (written < length) {
        const part = render(index).subarray(from, Math.min(lineLength, from + length - written))
        bytes.set(part, written)
        written += part.length
        index += 1
        from = 0
      }
      return bytes
    },
  }
}

/** A source over bytes in memory. */
export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    async read(start, length) {
      return bytes.slice(start, start + length)
    },
  }
}

