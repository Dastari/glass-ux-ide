import { describe, expect, it } from "vitest"
import { detectIndent, formatText, languageOf, reindent, tidy } from "./index.ts"
import { typescriptLexer } from "../languages/typescript/lexer.ts"

describe("reindent", () => {
  it("indents by bracket depth", () => {
    expect(reindent("function a() {\nif (b) {\nreturn [\n1,\n2,\n]\n}\n}", typescriptLexer, { indent: "  " })).toBe("function a() {\n  if (b) {\n    return [\n      1,\n      2,\n    ]\n  }\n}\n")
  })

  it("ignores brackets in strings and comments", () => {
    expect(reindent('const a = "{"\n// }\nconst b = 1', typescriptLexer, { indent: "  " })).toBe('const a = "{"\n// }\nconst b = 1\n')
  })

  it("leaves a template string and a block comment's text as they are", () => {
    const text = "const a = `\n    kept {\n`\n/*\n   * kept\n */\nconst b = 1\n"
    expect(reindent(text, typescriptLexer, { indent: "  " })).toBe(text)
  })

  it("indents a line that carries on, and a method chain", () => {
    expect(reindent("const total =\nprice + tax\nlist\n.map(f)\n.filter(g)", typescriptLexer, { indent: "  " })).toBe("const total =\n  price + tax\nlist\n  .map(f)\n  .filter(g)\n")
  })

  it("keeps one blank line in a row, and ends with one newline", () => {
    expect(reindent("a\n\n\n\nb\n\n\n", typescriptLexer, { indent: "  " })).toBe("a\n\nb\n")
  })

  it("changes nothing in a file that is already formatted", () => {
    const text = "export class A {\n  run() {\n    return { a: [1, 2] }\n  }\n}\n"
    expect(reindent(text, typescriptLexer)).toBe(text)
  })
})

describe("detectIndent", () => {
  it("finds tabs, the smallest step of spaces, or two spaces", () => {
    expect(detectIndent("a\n\tb")).toBe("\t")
    expect(detectIndent("a\n    b\n        c")).toBe("    ")
    expect(detectIndent("a")).toBe("  ")
  })
})

describe("formatText", () => {
  it("formats JSON and CSS by their own lexers", () => {
    expect(formatText('{\n"a": {\n"b": 1\n}\n}', "json", { indent: "  " })).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n')
    expect(formatText(".a {\ncolor: red;\n}", "css", { indent: "  " })).toBe(".a {\n  color: red;\n}\n")
  })

  it("keeps Markdown's line breaks and drops other trailing spaces", () => {
    expect(tidy("one  \ntwo   \n\n\n", { markdown: true })).toBe("one  \ntwo  \n")
    expect(formatText("a   \n", "plaintext")).toBe("a\n")
  })

  it("says when it does not know the language", () => {
    expect(formatText("x", "cobol")).toBeNull()
  })
})

describe("languageOf", () => {
  it("names a file's language as language servers do", () => {
    expect(languageOf("project:///src/a.tsx")).toBe("typescriptreact")
    expect(languageOf("project:///README.md")).toBe("markdown")
    expect(languageOf("project:///Makefile")).toBe("plaintext")
  })
})
