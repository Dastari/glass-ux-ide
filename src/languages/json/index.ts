import { compileLexer, type LexerDefinition } from "../../core/lexer.ts"

/** JSON, and JSON with comments as configuration files use it. */
export const jsonLexer = compileLexer({
  root: [
    { match: /\/\/.*/, token: "comment" },
    { match: /\/\*/, token: "comment", push: "comment" },
    { match: /"(?:[^"\\]|\\.)*"(?=\s*:)/, token: "property" },
    { match: /"(?:[^"\\]|\\.)*"?/, token: "string" },
    { match: /\b(?:true|false|null)\b/, token: "constant" },
    { match: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, token: "constant" },
    { match: /[{}[\]:,]/, token: "punctuation" },
  ],
  comment: [
    { match: /\*\//, token: "comment", pop: true },
    { match: /(?:[^*]|\*(?!\/))+/, token: "comment" },
  ],
} satisfies LexerDefinition)
