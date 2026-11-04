import { compileLexer, type LexerDefinition } from "../../core/lexer.ts"

const keywords = /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|namespace|new|of|override|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/

const shared = [
  { match: /\/\/.*/, token: "comment" },
  { match: /\/\*/, token: "comment", push: "comment" },
  // A regular expression, where one can start: after an operator or a keyword, never after a value
  // or in a closing JSX tag.
  { match: /(?<=(?:^|[(,=:[!&|?{};+\-*%~^]|=>|\b(?:return|typeof|case|in|of|delete|void|throw|new|yield|await))\s*)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuvy]*/, token: "string" },
  { match: /"(?:[^"\\]|\\.)*"?/, token: "string" },
  { match: /'(?:[^'\\]|\\.)*'?/, token: "string" },
  { match: /`/, token: "string", push: "template" },
  { match: /\b(?:true|false|null|undefined|NaN|Infinity)\b/, token: "constant" },
  { match: /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b/, token: "constant" },
  { match: keywords, token: "keyword" },
  { match: /\b[A-Z][\w$]*/, token: "type" },
  { match: /[a-zA-Z_$][\w$]*(?=\s*\()/, token: "function" },
  { match: /[a-zA-Z_$][\w$]*/ },
]

/** TypeScript and JavaScript, with JSX reading as ordinary tags and text. */
export const typescriptLexer = compileLexer({
  // A slash is a token of its own, so a regular expression after an operator can still start there.
  root: [...shared, { match: /[{}()[\]<>=:;,.?+!|&*%^~-]+|\//, token: "punctuation" }],
  comment: [
    { match: /\*\//, token: "comment", pop: true },
    { match: /(?:[^*]|\*(?!\/))+/, token: "comment" },
  ],
  template: [
    { match: /`/, token: "string", pop: true },
    { match: /\$\{/, token: "punctuation", push: "interpolation" },
    { match: /(?:[^`\\$]|\\.|\$(?!\{))+/, token: "string" },
  ],
  interpolation: [
    { match: /\}/, token: "punctuation", pop: true },
    { match: /\{/, token: "punctuation", push: "interpolation" },
    ...shared,
    { match: /[()[\]<>=:;,.?+!|&*%^~-]+|\//, token: "punctuation" },
  ],
} satisfies LexerDefinition)
