import { describe, expect, it, vi } from "vitest"
import { HistoryTooLargeError, memorySource, SaveConflictError, StaleSnapshotError, syntheticSource, TextDocument, tierOf, type ByteEdit, type ByteSource, type SaveTarget } from "./index.ts"

const encoder = new TextEncoder()
const open = (text: string, options = {}) => TextDocument.open(memorySource(encoder.encode(text)), options)
const GB = 1024 * 1024 * 1024

describe("TextDocument", () => {
  it("opens an empty document", async () => {
    const document = open("")
    await document.indexed
    const snapshot = document.snapshot()
    expect(snapshot.size).toBe(0)
    expect(snapshot.lineCount).toBe(1)
    expect(await snapshot.rows(0, 5)).toEqual([{ start: 0, end: 0, next: 0, text: "", continues: false }])
    await document.edit([{ start: 0, end: 0, text: "hi" }])
    expect(await document.snapshot().text()).toBe("hi")
  })

  it("keeps a snapshot unchanged through later edits", async () => {
    const document = open("one\ntwo\n")
    await document.indexed
    const before = document.snapshot()
    await document.edit([{ start: 0, end: 3, text: "ONE" }])
    await document.edit([{ start: 4, end: 7, text: "" }])
    expect(await before.text()).toBe("one\ntwo\n")
    expect(await document.snapshot().text()).toBe("ONE\n\n")
  })

  it("applies edits in the order they were made, without waiting", async () => {
    const document = open("")
    const typing = ["a", "b", "c", "d"].map((text, index) => document.edit([{ start: index, end: index, text }]))
    await Promise.all(typing)
    expect(await document.snapshot().text()).toBe("abcd")
  })

  it("rejects overlapping edits and leaves the document alone", async () => {
    const document = open("abcdef")
    await document.indexed
    await expect(document.edit([{ start: 0, end: 3, text: "" }, { start: 2, end: 4, text: "" }])).rejects.toThrow(/overlaps/)
    expect(await document.snapshot().text()).toBe("abcdef")
    await document.edit([{ start: 0, end: 1, text: "A" }])
    expect(await document.snapshot().text()).toBe("Abcdef")
  })

  it("applies several edits against the same starting text", async () => {
    const document = open("aaa bbb ccc")
    await document.indexed
    await document.edit([{ start: 0, end: 3, text: "x" }, { start: 8, end: 11, text: "zzzzz" }])
    expect(await document.snapshot().text()).toBe("x bbb zzzzz")
  })

  it("keeps a typing burst as one piece and one undo step", async () => {
    const document = open("")
    for (let index = 0; index < 500; index += 1) await document.edit([{ start: index, end: index, text: "a" }], { group: "typing" })
    expect(document.snapshot().pieces).toBe(1)
    expect(document.history()).toHaveLength(2)
    await document.undo()
    expect(document.snapshot().size).toBe(0)
  })

  it("starts a new undo step after a pause in typing", async () => {
    vi.useFakeTimers({ now: 1000 })
    const document = open("")
    await document.edit([{ start: 0, end: 0, text: "a" }], { group: "typing" })
    vi.setSystemTime(5000)
    await document.edit([{ start: 1, end: 1, text: "b" }], { group: "typing" })
    vi.useRealTimers()
    expect(document.history()).toHaveLength(3)
  })

  it("keeps an undone branch when typing starts again", async () => {
    const document = open("base")
    await document.indexed
    await document.edit([{ start: 4, end: 4, text: " first" }])
    const branch = document.current
    await document.undo()
    await document.edit([{ start: 4, end: 4, text: " second" }])
    expect(await document.snapshot().text()).toBe("base second")
    expect(await document.snapshotOf(branch).text()).toBe("base first")
    await document.restore(branch)
    expect(await document.snapshot().text()).toBe("base first")
  })

  it("redoes the most recent branch", async () => {
    const document = open("x")
    await document.indexed
    await document.edit([{ start: 1, end: 1, text: "a" }])
    await document.undo()
    await document.edit([{ start: 1, end: 1, text: "b" }])
    await document.undo()
    await document.redo()
    expect(await document.snapshot().text()).toBe("xb")
  })

  it("gives estimates before indexing and exact lines after", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const text = "line\n".repeat(1000)
    const memory = memorySource(encoder.encode(text))
    let reads = 0
    const slow: ByteSource = {
      size: memory.size,
      async read(start, length, signal) {
        if (length > 4096 && reads++ >= 0) await gate
        return memory.read(start, length, signal)
      },
    }
    const document = TextDocument.open(slow, { blockSize: 1024, pageSize: 1024 })
    const before = document.snapshot()
    expect(before.exactLines).toBe(false)
    expect(await before.lineStartBefore(100)).toBe(100)
    expect(await before.lineStartBefore(103)).toBe(100)
    expect((await before.rows(100, 2)).map((row) => row.text)).toEqual(["line", "line"])
    await expect(before.lineStart(5)).rejects.toThrow(/not known/)
    await document.edit([{ start: 0, end: 0, text: "added\n" }])
    release()
    await document.indexed
    const after = document.snapshot()
    expect(after.exactLines).toBe(true)
    expect(after.lineCount).toBe(1002)
    expect(await after.lineStart(1)).toBe(6)
  })

  it("estimates the line count of an unindexed file from a sample", async () => {
    const document = TextDocument.open(syntheticSource({ size: 100 * GB, lineLength: 128 }), { index: false })
    await document.sampled
    expect(document.snapshot().lineCount).toBe(Math.round((100 * GB) / 128) + 1)
  })

  it("resolves line counts in every history step", async () => {
    const document = open("a\nb\nc\n", { index: false })
    const edited = await document.edit([{ start: 2, end: 3, text: "B\nB" }])
    await (document as unknown as { buildIndex(options: object): Promise<void> }).buildIndex({})
    expect(document.snapshotOf(edited).exactLines).toBe(true)
    expect(document.snapshotOf(edited).lineCount).toBe(5)
    await document.undo()
    expect(document.snapshot().lineCount).toBe(4)
  })

  it("splits an enormous line into rows without building a string of it", async () => {
    const line = "x".repeat(300_000)
    const document = open(`${line}\nnext\n`)
    await document.indexed
    const rows = await document.snapshot().rows(0, 4, { maxBytes: 100_000 })
    expect(rows.map((row) => row.text.length)).toEqual([100_000, 100_000, 100_000, 4])
    expect(rows.map((row) => row.continues)).toEqual([true, true, false, false])
  })

  it("never cuts a character when it breaks a long line", async () => {
    const document = open("日".repeat(50_000))
    await document.indexed
    const rows = await document.snapshot().rows(0, 200, { maxBytes: 1000 })
    expect(rows.every((row) => !row.text.includes("�"))).toBe(true)
    expect(rows.map((row) => row.text).join("")).toBe("日".repeat(50_000))
  })

  it("hides carriage returns from rows but keeps their bytes", async () => {
    const document = open("one\r\ntwo\r\n")
    await document.indexed
    const snapshot = document.snapshot()
    expect((await snapshot.rows(0, 3)).map((row) => row.text)).toEqual(["one", "two", ""])
    expect(await snapshot.text()).toBe("one\r\ntwo\r\n")
  })

  it("streams a range in order", async () => {
    const document = open("0123456789")
    await document.indexed
    const parts: string[] = []
    for await (const part of document.snapshot().stream(2, 9, 3)) parts.push(new TextDecoder().decode(part))
    expect(parts).toEqual(["234", "567", "8"])
  })

  it("refuses to read a range too large for memory", async () => {
    const document = TextDocument.open(syntheticSource({ size: 2 * GB }), { index: false })
    await expect(document.snapshot().read(0, 2 * GB)).rejects.toThrow(/stream/)
  })

  it("names the tier for a size", () => {
    expect([1024, 10 * 1024 * 1024, GB, 50 * GB].map(tierOf)).toEqual([0, 1, 2, 3])
  })
})

describe("saving", () => {
  it("says which step it wrote, when an edit lands during the write", async () => {
    const document = TextDocument.open(memorySource(encoder.encode("ab")))
    await document.edit([{ start: 2, end: 2, text: "c" }])
    const written = document.current.id
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const saving = document.save({
      async write({ stream }) {
        const parts: Uint8Array[] = []
        for await (const part of stream()) parts.push(part)
        await held
        return memorySource(parts[0] ?? new Uint8Array())
      },
    })
    const editing = document.edit([{ start: 0, end: 0, text: ">" }])
    release()
    expect(await saving).toBe(written)
    await editing
    expect(document.current.id).not.toBe(written)
  })

  const target = (written: { text?: string; edits?: readonly ByteEdit[]; commits: number }): SaveTarget => ({
    async write({ stream, edits }) {
      const parts: Uint8Array[] = []
      for await (const part of stream()) parts.push(part)
      const bytes = encoder.encode(parts.map((part) => new TextDecoder().decode(part)).join(""))
      written.text = new TextDecoder().decode(bytes)
      written.edits = edits
      written.commits += 1
      return memorySource(bytes)
    },
  })

  it("writes the text and undoes past the save", async () => {
    const document = open("one\ntwo\nthree\n")
    await document.indexed
    await document.edit([{ start: 4, end: 7, text: "TWO" }])
    const written = { commits: 0 } as { text?: string; commits: number }
    await document.save(target(written))
    await document.indexed
    expect(written.text).toBe("one\nTWO\nthree\n")
    expect(await document.snapshot().text()).toBe("one\nTWO\nthree\n")
    await document.undo()
    expect(await document.snapshot().text()).toBe("one\ntwo\nthree\n")
  })

  it("keeps deleted text for undo, though the new file does not have it", async () => {
    const document = open("keep gone keep")
    await document.indexed
    await document.edit([{ start: 4, end: 9, text: "" }])
    await document.save(target({ commits: 0 }))
    await document.undo()
    expect(await document.snapshot().text()).toBe("keep gone keep")
  })

  it("offers only the changes to a backend that can patch", async () => {
    const document = TextDocument.open(syntheticSource({ size: 10 * GB }), { index: false })
    await document.edit([{ start: 5 * GB, end: 5 * GB + 3, text: "new" }])
    let edits: readonly ByteEdit[] = []
    await document.save({
      async write(content) {
        edits = content.edits
        return syntheticSource({ size: 10 * GB })
      },
    })
    expect(edits).toEqual([{ start: 5 * GB, end: 5 * GB + 3, text: encoder.encode("new") }])
  })

  it("keeps typing through a slow save, and those edits stay unsaved", async () => {
    const document = open("base")
    await document.indexed
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const written: string[] = []
    const saving = document.save({
      async write({ stream }) {
        for await (const part of stream()) written.push(new TextDecoder().decode(part))
        await gate
        return memorySource(encoder.encode(written.join("")))
      },
    })
    await document.edit([{ start: 4, end: 4, text: " typed" }])
    expect(await document.snapshot().text()).toBe("base typed")
    release()
    await saving
    expect(written.join("")).toBe("base")
    expect(await document.snapshot().text()).toBe("base typed")
    await document.undo()
    expect(await document.snapshot().text()).toBe("base")
  })

  it("keeps undo for text deleted while the save was running", async () => {
    const document = open("keep this text")
    await document.indexed
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const saving = document.save({
      async write({ size }) {
        await gate
        return memorySource(encoder.encode("keep this text").slice(0, size))
      },
    })
    await document.edit([{ start: 5, end: 10, text: "" }])
    release()
    await saving
    expect(await document.snapshot().text()).toBe("keep text")
    await document.undo()
    expect(await document.snapshot().text()).toBe("keep this text")
  })

  it("leaves everything alone if the write fails", async () => {
    const document = open("safe")
    await document.indexed
    await document.edit([{ start: 0, end: 0, text: "still " }])
    await expect(document.save({ write: () => Promise.reject(new Error("Disk full")) })).rejects.toThrow("Disk full")
    await document.undo()
    expect(await document.snapshot().text()).toBe("safe")
  })

  it("leaves everything alone on a conflict", async () => {
    const document = open("safe")
    await document.indexed
    await document.edit([{ start: 0, end: 4, text: "new" }])
    await expect(document.save({ write: () => Promise.reject(new SaveConflictError("Changed")) })).rejects.toBeInstanceOf(SaveConflictError)
    expect(await document.snapshot().text()).toBe("new")
    await document.undo()
    expect(await document.snapshot().text()).toBe("safe")
    await document.redo()
    await document.save(target({ commits: 0 }))
    expect(await document.snapshot().text()).toBe("new")
  })

  it("asks before dropping history it cannot keep", async () => {
    const document = open("x".repeat(1000))
    await document.indexed
    await document.edit([{ start: 0, end: 1000, text: "y" }])
    const error = await document.save(target({ commits: 0 }), { maxHistoryBytes: 100 }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(HistoryTooLargeError)
    expect((error as HistoryTooLargeError).bytes).toBe(1000)
    await document.save(target({ commits: 0 }), { maxHistoryBytes: 100, dropHistory: true })
    expect(document.canUndo).toBe(false)
    expect(await document.snapshot().text()).toBe("y")
  })

  it("refuses to read a snapshot from before the file was replaced", async () => {
    const document = open("old")
    await document.indexed
    const old = document.snapshot()
    await document.save(target({ commits: 0 }))
    await expect(old.text()).rejects.toBeInstanceOf(StaleSnapshotError)
  })

  it("has exact lines again after a save", async () => {
    const document = open("a\nb\n")
    await document.indexed
    await document.edit([{ start: 0, end: 0, text: "x\n" }])
    await document.save(target({ commits: 0 }))
    await document.indexed
    expect(document.snapshot().exactLines).toBe(true)
    expect(document.snapshot().lineCount).toBe(4)
  })
})

describe("search", () => {
  const find = async (text: string, pattern: RegExp, options = {}) => {
    const document = open(text)
    await document.indexed
    const found: { start: number; end: number; text: string }[] = []
    for await (const match of document.snapshot().search(pattern, options)) found.push(match)
    return found
  }

  it("reports byte offsets", async () => {
    expect(await find("日本 cat 語 cat", /cat/)).toEqual([
      { start: 7, end: 10, text: "cat" },
      { start: 15, end: 18, text: "cat" },
    ])
  })

  it("finds a match across a chunk boundary exactly once", async () => {
    const text = `${"a".repeat(95)}needle${"b".repeat(95)}`
    expect(await find(text, /needle/, { chunkSize: 100, maxMatchBytes: 10 })).toEqual([{ start: 95, end: 101, text: "needle" }])
  })

  it("matches the naive answer at every chunk size", async () => {
    const text = "x日y🙂needle\n".repeat(40)
    const expected = await find(text, /needle/, { chunkSize: 1024 * 1024 })
    expect(expected).toHaveLength(40)
    for (const chunkSize of [8, 16, 17, 31, 64, 100, 257]) {
      expect(await find(text, /needle/, { chunkSize, maxMatchBytes: 8 }), `chunk ${chunkSize}`).toEqual(expected)
    }
  })

  it("stops when aborted", async () => {
    const controller = new AbortController()
    const document = TextDocument.open(syntheticSource({ size: GB }), { index: false })
    const run = async () => {
      for await (const _ of document.snapshot().search(/never-there/, { chunkSize: 1024 * 1024, signal: controller.signal })) break
    }
    controller.abort()
    await expect(run()).rejects.toThrow()
  })

  it("searches a snapshot while the document changes", async () => {
    const document = open("find me\n".repeat(100))
    await document.indexed
    const snapshot = document.snapshot()
    await document.edit([{ start: 0, end: document.size, text: "" }])
    let count = 0
    for await (const _ of snapshot.search(/find/)) count += 1
    expect(count).toBe(100)
  })
})

describe("a file too large for memory", () => {
  it("edits the far end of 100 GB without reading the middle", async () => {
    const size = 100 * GB
    const source = syntheticSource({ size })
    const read = vi.spyOn(source, "read")
    const document = TextDocument.open(source, { index: false })
    await document.edit([{ start: size - 128, end: size - 128, text: "inserted\n" }])
    const end = document.snapshot()
    const rows = await end.rows(size - 128, 2)
    expect(rows[0]!.text).toBe("inserted")
    expect(rows[1]!.text.startsWith('{"line":')).toBe(true)
    const touched = read.mock.calls.reduce((sum, [, length]) => sum + length, 0)
    expect(touched).toBeLessThan(1024 * 1024)
  })
})
