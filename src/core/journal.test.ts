import { describe, expect, it } from "vitest"
import { TextDocument } from "./document.ts"
import { localHandle } from "./handle.ts"
import { journaled, type JournalEntry } from "./journal.ts"
import { memorySource } from "./synthetic.ts"

const encoder = new TextEncoder()
const open = (text: string) => localHandle(TextDocument.open(memorySource(encoder.encode(text))))
const textOf = async (handle: ReturnType<typeof open>) => handle.text(0, (await handle.state()).size)

async function recorded(text: string) {
  let entry: JournalEntry | null = null
  const handle = await journaled(open(text), "v1", { write: (next) => (entry = next) })
  return { handle, entry: () => entry }
}

describe("journaled", () => {
  it("rebuilds the text and the undo steps in a fresh document", async () => {
    const { handle, entry } = await recorded("hello")
    await handle.edit([{ start: 5, end: 5, text: " world" }], { group: "typing" })
    await handle.edit([{ start: 11, end: 11, text: "!" }], { group: "typing" })
    await handle.edit([{ start: 0, end: 1, text: "H" }])
    await handle.undo()
    await handle.edit([{ start: 0, end: 0, text: ">" }])
    const saved = entry()!
    expect(saved.base).toBe("v1")

    const fresh = await journaled(open("hello"), "v1", { write: () => undefined })
    await fresh.replay(saved)
    expect(await textOf(fresh)).toBe(await textOf(handle))
    await fresh.undo()
    await handle.undo()
    expect(await textOf(fresh)).toBe(await textOf(handle))
    await fresh.undo()
    await handle.undo()
    expect(await textOf(fresh)).toBe("hello")
    expect(await textOf(handle)).toBe("hello")
  })

  it("joins a replayed edit wherever the first one joined, however slow the replay", async () => {
    const { handle, entry } = await recorded("")
    await handle.edit([{ start: 0, end: 0, text: "a" }], { group: "typing" })
    await handle.edit([{ start: 1, end: 1, text: "b" }], { group: "typing" })
    const ops = entry()!.ops
    expect(ops.map((op) => op.kind === "edit" && op.join)).toEqual([false, true])
  })

  it("replays a jump to another branch", async () => {
    const { handle, entry } = await recorded("x")
    await handle.edit([{ start: 1, end: 1, text: "1" }])
    const first = (await handle.state()).version
    await handle.undo()
    await handle.edit([{ start: 1, end: 1, text: "2" }])
    await handle.restoreStep(first)
    const fresh = await journaled(open("x"), "v1", { write: () => undefined })
    await fresh.replay(entry()!)
    expect(await textOf(fresh)).toBe("x1")
  })

  it("replays replace all", async () => {
    const { handle, entry } = await recorded("a a a")
    await handle.replaceAll({ source: "a", flags: "g" }, "b")
    const fresh = await journaled(open("a a a"), "v1", { write: () => undefined })
    await fresh.replay(entry()!)
    expect(await textOf(fresh)).toBe("b b b")
  })

  it("holds nothing when the edits are all undone", async () => {
    const { handle, entry } = await recorded("a")
    await handle.edit([{ start: 1, end: 1, text: "b" }])
    expect(entry()).not.toBeNull()
    await handle.rebase("v2")
    expect(entry()).toBeNull()
  })

  it("gives up when an undo goes back past the last save, until the next one", async () => {
    const { handle, entry } = await recorded("a")
    await handle.edit([{ start: 1, end: 1, text: "b" }])
    await handle.rebase("v2")
    await handle.undo()
    expect(entry()).toBeNull()
    await handle.edit([{ start: 0, end: 0, text: "c" }])
    expect(entry()).toBeNull()
    await handle.rebase("v3")
    await handle.edit([{ start: 0, end: 0, text: "d" }])
    expect(entry()?.base).toBe("v3")
  })
})
