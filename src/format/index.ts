/**
 * A small formatter that runs in the page: it re-indents by bracket depth, using a language's lexer
 * so brackets in strings and comments do not count, removes trailing spaces, keeps at most one blank
 * line in a row, and ends the file with one newline. It does not reflow long lines or change what
 * the code says, so it is safe on any file its lexer reads. An application with a real formatter
 * gives the workbench a `FormatProvider` instead.
 */
import type { Lexer } from "../core/lexer.ts"
import { cssLexer } from "../languages/css/index.ts"
import { jsonLexer } from "../languages/json/index.ts"
import { typescriptLexer } from "../languages/typescript/lexer.ts"

export interface FormatOptions {
  /** One level of indentation. Default: what the file already uses, else two spaces. */
  indent?: string
}

interface ReindentOptions extends FormatOptions {
  /** Indent a line that carries on a statement, as JavaScript's do. Default true. */
  continuations?: boolean
  /** Nest JSX elements. Default false. */
  jsx?: boolean
}

const OPEN = new Set(["{", "[", "("])
const CLOSE = new Set(["}", "]", ")"])
/** A line that ends like this carries on into the next one. */
const CONTINUES = /(?:[=+\-*/%]|&&|\|\||\?\?|=>|\?)\s*$/
/** A line that starts like this carries on from the one before. */
const CONTINUATION = /^(?:\.(?!\.\.)|\?\.|&&|\|\||\?\?|\+(?!\+)|-(?!-)|\?(?!\?)|:(?!:)|\|(?!\|)|&(?!&))/

/** The indentation a file uses: a tab, or its smallest step of spaces. */
export function detectIndent(text: string): string {
  let smallest = Infinity
  for (const line of text.split("\n")) {
    const lead = /^[ \t]+(?=\S)/.exec(line)?.[0]
    if (!lead) continue
    if (lead.startsWith("\t")) return "\t"
    if (lead.length >= 2) smallest = Math.min(smallest, lead.length)
  }
  return Number.isFinite(smallest) ? " ".repeat(smallest) : "  "
}

/** One open level: how many brackets it holds, the indentation of what is inside, and whether it is a JSX element. */
interface Level {
  open: number
  inner: number
  jsx: boolean
}

const JSX_OPEN = /^<(?:[A-Za-z][\w.:-]*|>)/
const JSX_CLOSE = /^<\/(?:[A-Za-z][\w.:-]*)?>/

/**
 * Re-indents code by its brackets, as the file comment describes. Brackets opened on one line make
 * one level however many there are, as `fn({` does, and what is inside indents from the line that
 * opened it. With `jsx`, elements nest too.
 */
export function reindent(text: string, lexer: Lexer, { indent = detectIndent(text), continuations = true, jsx = false }: ReindentOptions = {}): string {
  const out: string[] = []
  let state = lexer.initial
  const levels: Level[] = []
  let carries = false
  let previous = { level: 0, base: 0, continued: false }
  let blank = 0
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const started = state
    const { tokens, state: ended } = lexer.lex(raw, state)
    state = ended
    // Inside a multi-line string or comment, the text is content: leave it exactly as it is.
    const kind = tokens.find((token) => token.text.trim())?.kind
    if (started !== lexer.initial && (kind === "comment" || kind === "string")) {
      out.push(kind === "comment" ? raw.trimEnd() : raw)
      blank = 0
      continue
    }
    const line = raw.trim()
    if (!line) {
      blank += 1
      if (blank === 1 && out.length) out.push("")
      continue
    }
    blank = 0
    const brackets: string[] = []
    let leading = 0
    let seenCode = false
    for (const token of tokens) {
      if (token.kind !== "punctuation") {
        if (token.text.trim()) seenCode = true
        continue
      }
      for (const char of token.text) {
        if (OPEN.has(char) || CLOSE.has(char)) {
          brackets.push(char)
          if (CLOSE.has(char) && !seenCode) leading += 1
          if (OPEN.has(char)) seenCode = true
        } else if (char.trim()) seenCode = true
      }
    }
    const code = tokens.filter((token) => token.kind !== "comment").map((token) => (token.kind === "string" ? "s" : token.text)).join("").trim()
    // JSX: an element that opens and does not close on its line holds the lines below it.
    const closesElement = jsx && JSX_CLOSE.test(code)
    const opensElement = jsx && JSX_OPEN.test(code) && !code.endsWith("/>") && !/<\/[\w.:-]*>\s*[)}]*,?$/.test(code) && !closesElement
    const attributesOpen = opensElement && !/>\s*[)}]*$/.test(code)

    // The levels this line's leading closers end, which it already sits outside of.
    let closed = 0
    if (closesElement && levels.at(-1)?.jsx) closed = 1
    else if (jsx && /^\/?>$/.test(code) && levels.at(-1)?.jsx) closed = 1
    else {
      for (let left = leading, index = levels.length - 1; left > 0 && index >= 0 && !levels[index]!.jsx; index -= 1) {
        left -= levels[index]!.open
        closed += 1
      }
    }
    // A line that closes levels lines up with the line that opened the outermost of them.
    const base = closed ? levels[levels.length - closed]!.inner - 1 : (levels.at(-1)?.inner ?? 0)
    const continued = continuations && Boolean(code) && CONTINUATION.test(code)
    let level = base
    if (continued) level = previous.base === base ? (previous.continued ? previous.level : previous.level + 1) : base + 1
    else if (continuations && carries) level = previous.base === base ? previous.level + 1 : base + 1
    out.push(indent.repeat(level) + line)

    // A tag's attributes ended: `>` keeps the element open for its children, `/>` ends it.
    if (jsx && /^\/?>$/.test(code) && levels.at(-1)?.jsx) {
      levels.pop()
      if (code === ">") levels.push({ open: 1, inner: level + 1, jsx: true })
    } else if (closesElement && levels.at(-1)?.jsx) levels.pop()

    let opened = 0
    for (const char of brackets) {
      if (OPEN.has(char)) opened += 1
      else if (opened > 0) opened -= 1
      else {
        const top = levels.at(-1)
        if (!top || top.jsx) continue
        top.open -= 1
        if (top.open === 0) levels.pop()
      }
    }
    if (opened > 0) levels.push({ open: opened, inner: level + 1, jsx: false })
    else if (opensElement) levels.push({ open: 1, inner: level + 1, jsx: true })
    else if (attributesOpen) levels.push({ open: 1, inner: level + 1, jsx: true })
    carries = continuations && opened === 0 && !opensElement && CONTINUES.test(code)
    previous = { level, base, continued: continued || (carries && level > base) }
  }
  while (out.length && out[out.length - 1] === "") out.pop()
  return out.length ? `${out.join("\n")}\n` : ""
}

/** Removes trailing spaces and blank runs, for languages it cannot indent. Markdown keeps its two-space line breaks. */
export function tidy(text: string, { markdown = false }: { markdown?: boolean } = {}): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => (markdown && / {2}$/.test(line) && line.trim() ? line.replace(/\s+$/, "  ") : line.trimEnd()))
  const kept = lines.filter((line, index) => line || lines[index - 1])
  while (kept.length && kept[kept.length - 1] === "") kept.pop()
  return kept.length ? `${kept.join("\n")}\n` : ""
}

const LEXERS: Record<string, { lexer: Lexer; continuations: boolean; jsx?: boolean }> = {
  typescript: { lexer: typescriptLexer, continuations: true },
  typescriptreact: { lexer: typescriptLexer, continuations: true, jsx: true },
  javascript: { lexer: typescriptLexer, continuations: true },
  javascriptreact: { lexer: typescriptLexer, continuations: true, jsx: true },
  json: { lexer: jsonLexer, continuations: false },
  jsonc: { lexer: jsonLexer, continuations: false },
  css: { lexer: cssLexer, continuations: false },
}

/** The languages {@link formatText} can format. */
export const FORMATTED_LANGUAGES: readonly string[] = [...Object.keys(LEXERS), "markdown", "plaintext"]

/** Formats a file's text, or returns null when it does not know the language. */
export function formatText(text: string, language: string, options: FormatOptions = {}): string | null {
  const known = LEXERS[language]
  if (known) return reindent(text, known.lexer, { ...options, continuations: known.continuations, jsx: known.jsx ?? false })
  if (language === "markdown") return tidy(text, { markdown: true })
  if (language === "plaintext") return tidy(text)
  return null
}

const EXTENSIONS: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "jsonc", css: "css", md: "markdown", markdown: "markdown",
  html: "html", htm: "html", xml: "xml", svg: "xml", txt: "plaintext", log: "plaintext",
}

/** A file's language id, as language servers name them, from its extension. */
export function languageOf(uri: string): string {
  const name = uri.split("/").pop() ?? uri
  return EXTENSIONS[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext"
}
