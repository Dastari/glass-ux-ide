import { describe, expect, it } from "vitest"
import { diffHunks, lineDiff } from "./diff.ts"

const rebuild = (lines: ReturnType<typeof lineDiff>, side: "old" | "new") =>
  lines.filter((line) => line.type === "context" || line.type === (side === "old" ? "remove" : "add")).map((line) => line.text).join("\n")

describe("lineDiff", () => {
  it("reads two equal texts as unchanged", () => {
    expect(lineDiff("a\nb", "a\nb").every((line) => line.type === "context")).toBe(true)
  })

  it("finds one changed line", () => {
    const lines = lineDiff("a\nb\nc", "a\nx\nc")
    expect(lines.filter((line) => line.type !== "context").map((line) => [line.type, line.text])).toEqual([["remove", "b"], ["add", "x"]])
  })

  it("numbers each side", () => {
    const lines = lineDiff("a\nb", "a\nnew\nb")
    expect(lines.find((line) => line.text === "new")).toEqual({ type: "add", text: "new", after: 2 })
    expect(lines.at(-1)).toEqual({ type: "context", text: "b", before: 2, after: 3 })
  })

  it("rebuilds both texts, whatever they hold", () => {
    let seed = 7
    const random = (limit: number) => (seed = (seed * 16807) % 2147483647) % limit
    for (let round = 0; round < 200; round += 1) {
      const a = Array.from({ length: random(30) }, () => String.fromCharCode(97 + random(4))).join("\n")
      const b = Array.from({ length: random(30) }, () => String.fromCharCode(97 + random(4))).join("\n")
      const lines = lineDiff(a, b)
      expect(rebuild(lines, "old")).toBe(a)
      expect(rebuild(lines, "new")).toBe(b)
    }
  })

  it("stays correct when the texts are too different to be worth the shortest edit", () => {
    const a = Array.from({ length: 6000 }, (_, index) => `a${index}`).join("\n")
    const b = Array.from({ length: 6000 }, (_, index) => `b${index}`).join("\n")
    const lines = lineDiff(a, b)
    expect(rebuild(lines, "old")).toBe(a)
    expect(rebuild(lines, "new")).toBe(b)
  })
})

describe("diffHunks", () => {
  it("keeps the change and the lines around it", () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`)
    const after = before.with(20, "changed")
    const hunks = diffHunks(lineDiff(before.join("\n"), after.join("\n")), 2)
    expect(hunks.map((line) => line.text)).toEqual(["line 18", "line 19", "line 20", "changed", "line 21", "line 22"])
  })
})
