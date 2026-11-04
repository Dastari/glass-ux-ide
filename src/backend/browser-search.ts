import type { FileEntry, FileProvider, FileUri } from "glass-ux/file-provider"
import type { SearchMatch, SearchProvider, SearchQuery } from "./language.ts"

/** Stops a walk here, so a huge tree cannot take the page with it. */
const FILE_LIMIT = 5000
/** A file larger than this is skipped: searching it belongs next to the data. */
const SEARCHED_BYTES = 2 * 1024 * 1024
const decoder = new TextDecoder()

/** Lists a provider's files, depth first, up to `limit`. */
export async function listFiles(provider: FileProvider, signal: AbortSignal, limit = FILE_LIMIT): Promise<FileEntry[]> {
  const files: FileEntry[] = []
  const walk = async (folder: FileUri) => {
    for (let cursor: string | null | undefined; ; ) {
      const page = await provider.readDirectory!(folder, { signal, cursor })
      for (const entry of page.entries) {
        if (files.length >= limit) return
        if (entry.kind === "directory") await walk(entry.uri)
        else files.push(entry)
      }
      cursor = page.cursor
      if (!cursor) return
    }
  }
  if (provider.readDirectory) await walk(provider.root ?? `${provider.scheme}:///`)
  return files
}

/** The regular expression for a query. Throws when `regex` is on and the pattern is not valid. */
export function patternOf({ text, matchCase, regex, wholeWord }: SearchQuery) {
  const body = regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])` : body, matchCase ? "gu" : "giu")
}

const MAX_LINE = 400

/** The matches in one file's text, with each line cut down around its first match. */
export function matchesIn(text: string, pattern: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = []
  let line = 0
  let lineStart = 0
  for (const match of text.matchAll(pattern)) {
    if (match[0].length === 0) continue
    for (let index = text.indexOf("\n", lineStart); index !== -1 && index < match.index; index = text.indexOf("\n", lineStart)) {
      line += 1
      lineStart = index + 1
    }
    const end = text.indexOf("\n", match.index)
    const whole = text.slice(lineStart, end === -1 ? text.length : end)
    const column = match.index - lineStart
    const from = column > MAX_LINE / 2 ? column - 20 : 0
    matches.push({ line, column, length: match[0].length, text: whole.slice(from, from + MAX_LINE) })
  }
  return matches
}

/**
 * Project search in the page, for files small enough to read. It reads each file through its
 * provider and reports as it goes, so it needs no backend. Files over 2 MiB are skipped: an
 * application with larger ones implements `SearchProvider` beside its data.
 */
export function browserSearch(files: readonly FileProvider[]): SearchProvider {
  return {
    async search(query, report, signal) {
      const pattern = patternOf(query)
      for (const provider of files) {
        for (const file of await listFiles(provider, signal)) {
          signal.throwIfAborted()
          const size = file.size ?? SEARCHED_BYTES + 1
          if (size > SEARCHED_BYTES) continue
          const bytes = size === 0 ? new Uint8Array() : await provider.read(file.uri, { offset: 0, length: size }, { signal })
          const matches = matchesIn(decoder.decode(bytes), pattern)
          if (matches.length) report({ uri: file.uri, matches })
        }
      }
    },
  }
}
