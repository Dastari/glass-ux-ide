/**
 * What an application implements to give the editor language features. Every part is optional.
 * The shapes follow LSP's concepts, so a language server adapts in a few lines, and an application
 * with none can answer however it likes. All offsets are UTF-16 positions, as LSP's are.
 */
import type { FileProvider, FileUri } from "glass-ux/file-provider"
import type { Position } from "../core/types.ts"

/** Reads a document without forcing the whole of it into a string. */
export interface DocumentReader {
  readonly uri: FileUri
  /** The text of a line. */
  line(line: number): Promise<string>
  /** Text between two positions. */
  text(start: Position, end: Position): Promise<string>
}

/** A range between two positions. */
export interface TextRange {
  start: Position
  end: Position
}

/** A replacement of a range. */
export interface TextEdit {
  range: TextRange
  text: string
}

export type CompletionKind = "text" | "method" | "function" | "field" | "variable" | "class" | "interface" | "module" | "property" | "keyword" | "snippet" | "constant" | "type"

/** One suggestion. */
export interface CompletionItem {
  label: string
  kind?: CompletionKind
  /** Shown beside the label: a type or signature. */
  detail?: string
  /** A longer description, shown beside the list. */
  documentation?: string
  /** Text to insert. Defaults to `label`. */
  insertText?: string
  /** Matched against what is typed, instead of `label`. */
  filterText?: string
}

export interface CompletionContext {
  /** The character that opened the list, when one did. */
  triggerCharacter?: string
}

export interface CompletionProvider {
  /** Characters that open the list, beyond typing an identifier. */
  readonly triggerCharacters?: readonly string[]
  provideCompletions(document: DocumentReader, position: Position, context: CompletionContext, signal: AbortSignal): Promise<readonly CompletionItem[]>
}

export type DiagnosticSeverity = "error" | "warning" | "info"

/** A problem in a document. */
export interface Diagnostic {
  range: TextRange
  severity: DiagnosticSeverity
  message: string
  /** Where it came from: "typescript", "lint". */
  source?: string
  code?: string
}

export interface DiagnosticsProvider {
  /** Pushes each new full set for a document. Returns a way to stop. */
  subscribe(uri: FileUri, report: (diagnostics: readonly Diagnostic[]) => void): () => void
}

export interface FormatProvider {
  format(document: DocumentReader, signal: AbortSignal): Promise<readonly TextEdit[]>
}

/**
 * For a backend that keeps its own copy of the text, as a language server does. The workbench sends
 * files up to 5 MB: the text when one opens, then one edit per change, with ranges in the text as
 * it was before that change. Larger files stay with the workbench.
 */
export interface DocumentSync {
  opened(document: { uri: FileUri; language: string; version: number; text: string }): void
  changed(uri: FileUri, version: number, edits: readonly TextEdit[]): void
  closed(uri: FileUri): void
}

/** What a hover shows. */
export interface Hover {
  /** Plain text. Line breaks are kept. */
  contents: string
  /** The text it describes, when that is more than the word under the pointer. */
  range?: TextRange
}

export interface HoverProvider {
  provideHover(document: DocumentReader, position: Position, signal: AbortSignal): Promise<Hover | null>
}

/** A place in a file. */
export interface Location {
  uri: FileUri
  range: TextRange
}

export interface DefinitionProvider {
  /** Where the symbol at a position is defined. The first is where Go to definition goes. */
  provideDefinition(document: DocumentReader, position: Position, signal: AbortSignal): Promise<readonly Location[]>
}

/** Edits to any number of files, applied together as one step in each. */
export interface WorkspaceEdit {
  changes: Readonly<Record<FileUri, readonly TextEdit[]>>
}

export interface RenameProvider {
  /** The range a rename would change and the name in it, or null where nothing can be renamed. */
  prepareRename?(document: DocumentReader, position: Position, signal: AbortSignal): Promise<{ range: TextRange; placeholder: string } | null>
  provideRenameEdits(document: DocumentReader, position: Position, newName: string, signal: AbortSignal): Promise<WorkspaceEdit>
}

/** What a person is looking for across files. */
export interface SearchQuery {
  text: string
  matchCase?: boolean
  /** `text` is a regular expression. */
  regex?: boolean
  wholeWord?: boolean
}

/** One match in a file. */
export interface SearchMatch {
  /** Zero-based line. */
  line: number
  /** Zero-based UTF-16 column of the match in that line. */
  column: number
  /** UTF-16 length of the match. */
  length: number
  /** The line's text, which may be shortened around the match. */
  text: string
}

/** A file's matches. */
export interface SearchResult {
  uri: FileUri
  matches: readonly SearchMatch[]
}

/**
 * Searches a project next to its data. `browserSearch` is the version that runs in the page; an
 * application with a server implements this to search everything.
 */
export interface SearchProvider {
  /** Calls `report` as files finish, and settles when the search has. */
  search(query: SearchQuery, report: (result: SearchResult) => void, signal: AbortSignal): Promise<void>
}

/** Everything an application can provide. Whatever is missing simply does not appear. */
export interface IdeBackend {
  files?: readonly FileProvider[]
  search?: SearchProvider
  documents?: DocumentSync
  completion?: CompletionProvider
  diagnostics?: DiagnosticsProvider
  /** Without one, Format uses the formatter in `glass-ux-ide/format` where it knows the language. */
  format?: FormatProvider
  hover?: HoverProvider
  definition?: DefinitionProvider
  rename?: RenameProvider
}
