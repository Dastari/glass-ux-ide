import { describe, expect, it } from "vitest"
import { typescriptLexer } from "../languages/typescript/lexer.ts"

const lex = (lines: string[]) => {
  let state = typescriptLexer.initial
  return lines.map((line) => {
    const result = typescriptLexer.lex(line, state)
    state = result.state
    return result.tokens
  })
}
const kinds = (tokens: { text: string; kind?: string }[]) => tokens.filter((token) => token.kind).map((token) => `${token.kind}:${token.text}`)

describe("lexer", () => {
  it("keeps every character", () => {
    for (const line of ["const x = 1 // note", "a `b ${c} d` e", "€ 日本語 🙂 #!", "/* open", ""]) {
      expect(lex([line])[0]!.map((token) => token.text).join("")).toBe(line)
    }
  })

  it("names the common tokens", () => {
    expect(kinds(lex(['const a: Foo = run("x", 12)'])[0]!)).toEqual(["keyword:const", "punctuation::", "type:Foo", "punctuation:=", "function:run", "punctuation:(", 'string:"x"', "punctuation:,", "constant:12", "punctuation:)"])
  })

  it("carries a block comment across lines", () => {
    const [first, second, third] = lex(["/* start", "middle", "end */ const"])
    expect(kinds(first!)).toEqual(["comment:/* start"])
    expect(kinds(second!)).toEqual(["comment:middle"])
    expect(kinds(third!)).toEqual(["comment:end */", "keyword:const"])
  })

  it("carries templates and nested interpolation across lines", () => {
    const [first, second] = lex(["`a ${b + {c: 1}.c} text", "more ${d}` + 1"])
    expect(kinds(first!)).toContain("string: text")
    expect(kinds(second!)).toEqual(["string:more ", "punctuation:${", "punctuation:}", "string:`", "punctuation:+", "constant:1"])
  })

  it("restarts from a saved state", () => {
    const inside = typescriptLexer.lex("/* open", typescriptLexer.initial).state
    expect(kinds(typescriptLexer.lex("still */ let", inside).tokens)).toEqual(["comment:still */", "keyword:let"])
  })

  it("leaves a huge line plain past the limit", () => {
    const line = "const ".repeat(5000)
    const { tokens } = typescriptLexer.lex(line, typescriptLexer.initial)
    expect(tokens.map((token) => token.text).join("")).toBe(line)
    expect(tokens[tokens.length - 1]!.kind).toBeUndefined()
  })
})
