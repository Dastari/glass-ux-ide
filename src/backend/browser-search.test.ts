import { describe, expect, it } from "vitest"
import { memoryFiles } from "glass-ux/file-provider/memory"
import { browserSearch, listFiles, matchesIn, patternOf } from "./browser-search.ts"
import type { SearchResult } from "./language.ts"

const files = memoryFiles({ "a.ts": "const Journal = 1\nlet journal\n", "src/b.ts": "journalist\n", "src/c.txt": "nothing\n" }, { scheme: "t", label: "T" })
const signal = new AbortController().signal

async function run(query: Parameters<typeof patternOf>[0]) {
  const results: SearchResult[] = []
  await browserSearch([files]).search(query, (result) => results.push(result), signal)
  return results
}

describe("listFiles", () => {
  it("walks into folders", async () => {
    expect((await listFiles(files, signal)).map((file) => file.name).sort()).toEqual(["a.ts", "b.ts", "c.txt"])
  })

  it("stops at the limit", async () => {
    expect(await listFiles(files, signal, 2)).toHaveLength(2)
  })
})

describe("matchesIn", () => {
  it("gives each match its line and column", () => {
    expect(matchesIn("one\ntwo one", /one/gu)).toEqual([
      { line: 0, column: 0, length: 3, text: "one" },
      { line: 1, column: 4, length: 3, text: "two one" },
    ])
  })

  it("ignores a pattern that matches nothing wide", () => {
    expect(matchesIn("abc", /x*/gu)).toEqual([])
  })

  it("cuts a very long line down around the match", () => {
    const [match] = matchesIn(`${"a".repeat(5000)}needle${"b".repeat(5000)}`, /needle/gu)
    expect(match!.column).toBe(5000)
    expect(match!.text.length).toBeLessThanOrEqual(400)
    expect(match!.text).toContain("needle")
  })
})

describe("browserSearch", () => {
  it("ignores case by default, across files", async () => {
    expect((await run({ text: "journal" })).map((result) => result.matches.length).sort()).toEqual([1, 2])
  })

  it("matches case and whole words on request", async () => {
    expect((await run({ text: "Journal", matchCase: true })).flatMap((result) => result.matches)).toHaveLength(1)
    expect((await run({ text: "journal", wholeWord: true })).flatMap((result) => result.matches)).toHaveLength(2)
  })

  it("takes a regular expression, and treats text literally without it", async () => {
    expect(await run({ text: "j.urnal", regex: true })).toHaveLength(2)
    expect(await run({ text: "j.urnal" })).toHaveLength(0)
  })

  it("rejects a broken regular expression", async () => {
    await expect(run({ text: "(", regex: true })).rejects.toBeInstanceOf(SyntaxError)
  })
})
