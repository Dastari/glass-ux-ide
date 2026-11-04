import { compileLexer, type LexerDefinition } from "../../core/lexer.ts"

/** HTML and XML: tags, attributes, comments and entities. Script and style read as text. */
export const htmlLexer = compileLexer({
  root: [
    { match: /<!--/, token: "comment", push: "comment" },
    { match: /<!\w[^>]*>?/, token: "keyword" },
    { match: /<\/?[\w:-]+/, token: "tag", push: "tag" },
    { match: /&#?\w+;/, token: "constant" },
  ],
  tag: [
    { match: /\/?>/, token: "tag", pop: true },
    { match: /[\w:-]+(?=\s*=)/, token: "property" },
    { match: /"[^"]*"?|'[^']*'?/, token: "string" },
    { match: /[\w:-]+/, token: "property" },
    { match: /=/, token: "punctuation" },
  ],
  comment: [
    { match: /-->/, token: "comment", pop: true },
    { match: /(?:[^-]|-(?!->))+/, token: "comment" },
  ],
} satisfies LexerDefinition)
