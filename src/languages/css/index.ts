import { compileLexer, type LexerDefinition } from "../../core/lexer.ts"

const comment = [{ match: /\/\*/, token: "comment", push: "comment" }]
const values = [
  { match: /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/, token: "string" },
  { match: /#[\da-fA-F]{3,8}\b/, token: "constant" },
  { match: /-?\d*\.?\d+(?:%|[a-zA-Z]+)?/, token: "constant" },
  { match: /--[\w-]+/, token: "variable" },
  { match: /[\w-]+(?=\()/, token: "function" },
  { match: /!important\b/, token: "keyword" },
]

/** CSS, with nesting, custom properties and at-rules. */
export const cssLexer = compileLexer({
  root: [
    ...comment,
    { match: /@[\w-]+/, token: "keyword" },
    { match: /\{/, token: "punctuation", push: "block" },
    { match: /[.#][\w-]+/, token: "type" },
    { match: /::?[\w-]+/, token: "keyword" },
    ...values,
    { match: /[\w-]+/, token: "tag" },
    { match: /[,>+~*()[\]=:;]/, token: "punctuation" },
  ],
  block: [
    ...comment,
    { match: /\}/, token: "punctuation", pop: true },
    { match: /\{/, token: "punctuation", push: "block" },
    { match: /@[\w-]+/, token: "keyword" },
    { match: /(?:--)?[\w-]+(?=\s*:(?!:))/, token: "property" },
    ...values,
    { match: /&|[.#][\w-]+|::?[\w-]+/, token: "type" },
    { match: /[,>+~*()[\]=:;/]/, token: "punctuation" },
  ],
  comment: [
    { match: /\*\//, token: "comment", pop: true },
    { match: /(?:[^*]|\*(?!\/))+/, token: "comment" },
  ],
} satisfies LexerDefinition)
