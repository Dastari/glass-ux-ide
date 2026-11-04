export {
  HistoryTooLargeError,
  SaveConflictError,
  StaleSnapshotError,
  TextDocument,
  TextSnapshot,
  type EditOptions,
  type HistoryEntry,
  type SaveContent,
  type SaveOptions,
  type SaveTarget,
  type TextDocumentOptions,
  type TextRow,
} from "./document.ts"
export { localHandle, REPLACE_LIMIT, type DocumentHandle, type DocumentState, type FindProgress, type FindQuery, type HistoryStep } from "./handle.ts"
export { diffHunks, lineDiff, type LineChange } from "./diff.ts"
export { journaled, type JournaledHandle, type JournalEntry, type JournalOp, type JournalSink } from "./journal.ts"
export { compileLexer, type Lexer, type LexerDefinition, type LexerRule, type LexResult, type Token } from "./lexer.ts"
export type { SearchMatch, SearchOptions } from "./search.ts"
export { memorySource, syntheticSource } from "./synthetic.ts"
export { tierOf, type Tier } from "./tiers.ts"
export { connectDocument, serveDocument, type SourceSpec } from "./worker.ts"
export { TextRangeError, type ByteEdit, type ByteRange, type ByteSource, type Position } from "./types.ts"
