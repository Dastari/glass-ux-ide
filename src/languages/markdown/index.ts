import { compileLexer, type LexerDefinition } from "../../core/lexer.ts"

const inline = [
  { match: /`[^`]*`?/, token: "string" },
  { match: /\*\*[^*]+\*\*|__[^_]+__/, token: "keyword" },
  { match: /\*[^*\s][^*]*\*|_[^_\s][^_]*_/, token: "comment" },
  { match: /!?\[[^\]]*\]\([^)]*\)?/, token: "function" },
  { match: /<https?:[^>]*>|https?:\/\/\S+/, token: "function" },
]

/** Markdown: headings, emphasis, code, links, lists and fenced code blocks. */
export const markdownLexer = compileLexer({
  root: [
    { match: /^```.*/, token: "string", push: "fence" },
    { match: /^#{1,6}\s.*/, token: "type" },
    { match: /^\s*(?:[-*+]|\d+[.)])(?=\s)/, token: "punctuation" },
    { match: /^\s*>.*/, token: "comment" },
    { match: /^(?:-{3,}|\*{3,}|_{3,})\s*$/, token: "punctuation" },
    ...inline,
  ],
  fence: [
    { match: /^```\s*$/, token: "string", pop: true },
    { match: /.+/, token: "string" },
  ],
} satisfies LexerDefinition)
