/**
 * UTF-8 arithmetic that needs no string. A 2 GB line cannot become a JavaScript string, so columns
 * have to be counted from the bytes.
 */

/** UTF-16 code units in UTF-8 bytes. Each lead byte contributes; four-byte forms need two units. */
export function utf16Length(bytes: Uint8Array): number {
  let units = 0
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!
    if (byte < 0x80 || (byte >= 0xc0 && byte < 0xf0)) units += 1
    else if (byte >= 0xf0) units += 2
  }
  return units
}

/** The byte length after `units` UTF-16 code units, stopping at the end of `bytes`. */
export function byteLengthOfUnits(bytes: Uint8Array, units: number): { bytes: number; units: number } {
  let seen = 0
  let index = 0
  while (index < bytes.length && seen < units) {
    const byte = bytes[index]!
    const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4
    seen += width === 4 ? 2 : 1
    index += width
  }
  return { bytes: Math.min(index, bytes.length), units: seen }
}

const isContinuation = (byte: number) => (byte & 0xc0) === 0x80

/**
 * Moves `index` back so that a slice ending there does not cut a character. At the end of the
 * buffer the next byte is unknown, so it checks whether the last character is complete instead.
 */
export function alignToCharacter(bytes: Uint8Array, index: number): number {
  const end = Math.min(index, bytes.length)
  if (end < bytes.length) {
    let at = end
    const floor = Math.max(0, at - 3)
    while (at > floor && isContinuation(bytes[at]!)) at -= 1
    return at
  }
  const floor = Math.max(0, end - 4)
  for (let at = end - 1; at >= floor; at -= 1) {
    const byte = bytes[at]!
    if (isContinuation(byte)) continue
    const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4
    return at + width > end ? at : end
  }
  return end
}

/** The UTF-8 length of a string slice, without encoding it. */
export function utf8Length(text: string, from = 0, to = text.length): number {
  let bytes = 0
  for (let index = from; index < to; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit < 0xdc00) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}
