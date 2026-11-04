/** Shared shapes for the text engine. These import nothing, so a worker can use them directly. */

/** A half-open range of byte offsets: `start` is included, `end` is not. */
export interface ByteRange {
  start: number
  end: number
}

/** A place in the text. `column` counts UTF-16 code units, as the DOM and LSP do. */
export interface Position {
  line: number
  column: number
}

/** A replacement of a byte range. An insertion has `start === end`; a deletion has empty text. */
export interface ByteEdit {
  start: number
  end: number
  text: string | Uint8Array
}

/** Where a document's original bytes come from. It must return exactly the bytes asked for. */
export interface ByteSource {
  readonly size: number
  read(start: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
}

/** Thrown when an operation is given a range outside the document. */
export class TextRangeError extends Error {
  override name = "TextRangeError"
}
