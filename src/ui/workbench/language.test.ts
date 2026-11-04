import { describe, expect, it } from "vitest"
import { editBetween } from "./language.ts"

const apply = (text: string, edit: NonNullable<ReturnType<typeof editBetween>>) => {
  const lines = text.split("\n")
  const offset = (position: { line: number; column: number }) => lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.column
  return text.slice(0, offset(edit.range.start)) + edit.text + text.slice(offset(edit.range.end))
}

describe("editBetween", () => {
  it("is nothing for equal texts", () => {
    expect(editBetween("a", "a")).toBeNull()
  })

  it("covers only what changed, in lines and columns", () => {
    expect(editBetween("one\ntwo\nthree", "one\nTWO\nthree")).toEqual({ range: { start: { line: 1, column: 0 }, end: { line: 1, column: 3 } }, text: "TWO" })
  })

  it("rebuilds the new text from the old, whatever changed", () => {
    for (const [before, after] of [["", "x"], ["abc", ""], ["a\nb", "a\nb\nc"], ["🙂🙂", "🙂😀"], ["aaa", "aa"]]) {
      expect(apply(before!, editBetween(before!, after!)!)).toBe(after)
    }
  })
})
