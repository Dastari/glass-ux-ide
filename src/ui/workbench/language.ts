/** Language features over open documents: reading them for a backend, and applying its edits. */
import type { FileUri } from "glass-ux/file-provider"
import type { DocumentReader, TextEdit } from "../../backend/language.ts"
import type { DocumentHandle } from "../../core/handle.ts"
import type { Position } from "../../core/types.ts"
import type { WorkbenchStore } from "./store.ts"

/** Reads a document for a backend without turning all of it into a string. */
export function readerOf(uri: FileUri, handle: DocumentHandle): DocumentReader {
  return {
    uri,
    async line(line) {
      const start = await handle.lineStart(line)
      return (await handle.rows(start, 1, 64 * 1024))[0]?.text ?? ""
    },
    async text(start, end) {
      return handle.text(await handle.offsetAt(start), await handle.offsetAt(end))
    },
  }
}

/** Applies edits addressed in lines and columns as one undo step, and redraws every editor of the file. */
export async function applyTextEdits(store: WorkbenchStore, uri: FileUri, edits: readonly TextEdit[], label: string) {
  const record = store.get(uri)
  if (!record || !edits.length) return
  const handle = record.opened.handle
  const bytes = await Promise.all(edits.map(async ({ range, text }) => ({ start: await handle.offsetAt(range.start), end: await handle.offsetAt(range.end), text })))
  const state = await handle.edit(bytes, { label })
  store.changed(uri, state)
  await Promise.all(store.viewsOf(uri).map((view) => view.refresh()))
}

/** Where a line's character at `index` is, given the text before it. */
function positionIn(text: string, index: number): Position {
  let line = 0
  let lineStart = 0
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) {
    line += 1
    lineStart = at + 1
  }
  return { line, column: index - lineStart }
}

/**
 * The one edit that turns `before` into `after`: what differs between their common start and end.
 * Its range is in `before`, in UTF-16 columns, as a language server reads it.
 */
export function editBetween(before: string, after: string): TextEdit | null {
  if (before === after) return null
  let start = 0
  const shorter = Math.min(before.length, after.length)
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start += 1
  let end = 0
  while (end < shorter - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end += 1
  // Never split a surrogate pair.
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1]!)) start -= 1
  if (end > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - end]!)) end -= 1
  return { range: { start: positionIn(before, start), end: positionIn(before, before.length - end) }, text: after.slice(start, after.length - end) }
}
