import { describe, expect, it } from "vitest"
import type { Lexer } from "../core/lexer.ts"
import { cssLexer } from "./css/index.ts"
import { htmlLexer } from "./html/index.ts"
import { jsonLexer } from "./json/index.ts"
import { markdownLexer } from "./markdown/index.ts"

/** Lexes lines in order, as the editor does, and gives each line's kinds with their text. */
function lex(lexer: Lexer, text: string) {
  let state = lexer.initial
  return text.split("\n").map((line) => {
    const result = lexer.lex(line, state)
    state = result.state
    expect(result.tokens.map((token) => token.text).join("")).toBe(line)
    return result.tokens.filter((token) => token.kind).map((token) => `${token.kind}:${token.text}`)
  })
}

describe("jsonLexer", () => {
  it("tells keys from values", () => {
    expect(lex(jsonLexer, '{ "a": "b", "n": -1.5e3, "t": true }')[0]).toEqual(["punctuation:{", 'property:"a"', "punctuation::", 'string:"b"', "punctuation:,", 'property:"n"', "punctuation::", "constant:-1.5e3", "punctuation:,", 'property:"t"', "punctuation::", "constant:true", "punctuation:}"])
  })

  it("carries a block comment across lines", () => {
    expect(lex(jsonLexer, "/* one\ntwo */ 1")).toEqual([["comment:/* one"], ["comment:two */", "constant:1"]])
  })
})

describe("cssLexer", () => {
  it("reads selectors, properties and values", () => {
    const [selector, declaration] = lex(cssLexer, ".a:hover {\n  --gap: calc(1rem + 2px);\n}")
    expect(selector).toEqual(["type:.a", "keyword::hover", "punctuation:{"])
    expect(declaration).toContain("property:--gap")
    expect(declaration).toContain("function:calc")
    expect(declaration).toContain("constant:1rem")
  })
})

describe("markdownLexer", () => {
  it("reads headings, emphasis and code, and fences across lines", () => {
    const lines = lex(markdownLexer, "# Title\nSome **bold** and `code`.\n```ts\nconst a = 1\n```\n- item")
    expect(lines[0]).toEqual(["type:# Title"])
    expect(lines[1]).toEqual(["keyword:**bold**", "string:`code`"])
    expect(lines[3]).toEqual(["string:const a = 1"])
    expect(lines[5]).toEqual(["punctuation:-"])
  })
})

describe("htmlLexer", () => {
  it("reads tags, attributes and comments", () => {
    const [line] = lex(htmlLexer, '<a href="/x" hidden>Go</a><!-- note -->')
    expect(line).toEqual(["tag:<a", "property:href", "punctuation:=", 'string:"/x"', "property:hidden", "tag:>", "tag:</a>", "comment:<!-- note -->"])
  })
})
