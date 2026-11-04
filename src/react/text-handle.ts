import { localHandle, memorySource, TextDocument, type DocumentHandle } from "../core/index.ts"

/** A document held on this thread, for a short value such as a form field's. */
export function createTextHandle(text: string): DocumentHandle {
  return localHandle(TextDocument.open(memorySource(new TextEncoder().encode(text))))
}
