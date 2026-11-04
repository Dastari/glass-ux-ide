import { memoryFiles } from "glass-ux/file-provider/memory"
import type { FileProvider } from "glass-ux/file-provider"
import { describe, expect, it, vi } from "vitest"
import { SaveConflictError, TextDocument } from "../core/index.ts"
import { fileSource, fileTarget } from "./file-source.ts"

const signal = new AbortController().signal
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function open(provider: FileProvider, uri: string) {
  const stat = await provider.stat(uri, { signal })
  const document = TextDocument.open(fileSource(provider, stat))
  await document.indexed
  return { document, state: { stat } }
}

const contents = async (provider: FileProvider, uri: string) => {
  const stat = await provider.stat(uri, { signal })
  return decode(await provider.read(uri, { offset: 0, length: stat.size! }, { signal }))
}

describe("saving through a FileProvider", () => {
  const uri = "memory:///notes.txt"

  it("reads a file and saves an edit back", async () => {
    const provider = memoryFiles({ "notes.txt": "one\ntwo\n" })
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 4, end: 7, text: "TWO" }])
    await document.save(fileTarget(provider, state))
    expect(await contents(provider, uri)).toBe("one\nTWO\n")
  })

  it("sends only the edits when the provider can apply them", async () => {
    const provider = memoryFiles({ "notes.txt": "x".repeat(10_000) })
    const write = vi.spyOn(provider, "write")
    const apply = vi.spyOn(provider, "applyEdits")
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 5, end: 6, text: "Y" }])
    await document.save(fileTarget(provider, state))
    expect(write).not.toHaveBeenCalled()
    expect(apply.mock.calls[0]![2]).toEqual([{ offset: 5, deleteLength: 1, insert: new TextEncoder().encode("Y") }])
    expect(await contents(provider, uri)).toBe(`xxxxxY${"x".repeat(9994)}`)
  })

  it("streams the whole text when it cannot", async () => {
    const provider = memoryFiles({ "notes.txt": "abc" })
    const { applyEdits: _unused, ...plain } = provider
    const { document, state } = await open(plain as FileProvider, uri)
    await document.edit([{ start: 3, end: 3, text: "d" }])
    await document.save(fileTarget(plain as FileProvider, state))
    expect(await contents(provider, uri)).toBe("abcd")
  })

  it("saves twice in a row against the new version", async () => {
    const provider = memoryFiles({ "notes.txt": "abc" })
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 0, end: 0, text: "1" }])
    await document.save(fileTarget(provider, state))
    await document.indexed
    await document.edit([{ start: 0, end: 0, text: "2" }])
    await document.save(fileTarget(provider, state))
    expect(await contents(provider, uri)).toBe("21abc")
  })

  it("keeps undo working across saves, reading the new version", async () => {
    const provider = memoryFiles({ "notes.txt": "keep gone keep" })
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 4, end: 9, text: "" }])
    await document.save(fileTarget(provider, state))
    await document.indexed
    await document.undo()
    expect(await document.snapshot().text()).toBe("keep gone keep")
  })

  it("holds the save when the file changed elsewhere, and keeps the edits", async () => {
    const provider = memoryFiles({ "notes.txt": "abc" })
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 0, end: 1, text: "A" }])
    const other = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("changed elsewhere"))
        controller.close()
      },
    })
    await provider.write!(uri, other, { base: { overwrite: true }, signal })
    await expect(document.save(fileTarget(provider, state))).rejects.toBeInstanceOf(SaveConflictError)
    expect(await contents(provider, uri)).toBe("changed elsewhere")
    expect(await document.snapshot().text()).toBe("Abc")
  })

  it("overwrites with the whole text, never a patch aimed at the old version", async () => {
    const provider = memoryFiles({ "notes.txt": "abc" })
    const { document, state } = await open(provider, uri)
    await document.edit([{ start: 0, end: 0, text: "mine " }])
    const other = new Blob(["a much longer change from elsewhere"]).stream()
    await provider.write!(uri, other, { base: { overwrite: true }, signal })
    const apply = vi.spyOn(provider, "applyEdits")
    await document.save(fileTarget(provider, { stat: await provider.stat(uri, { signal }) }, { overwrite: true }))
    expect(apply).not.toHaveBeenCalled()
    expect(await contents(provider, uri)).toBe("mine abc")
    void state
  })

  it("refuses to mix pages from two versions", async () => {
    const provider = memoryFiles({ "notes.txt": "abc" })
    const stat = await provider.stat(uri, { signal })
    await provider.applyEdits!(uri, stat.version, [{ offset: 0, deleteLength: 1, insert: new TextEncoder().encode("Z") }], { signal })
    await expect(fileSource(provider, stat).read(0, 3)).rejects.toMatchObject({ code: "changed" })
  })
})
