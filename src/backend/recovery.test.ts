import { describe, expect, it } from "vitest"
import { memoryRecovery } from "./recovery.ts"

describe("memoryRecovery", () => {
  it("keeps and forgets a journal", async () => {
    const store = memoryRecovery()
    const entry = { base: "1", ops: [{ kind: "undo" as const }], at: 1 }
    await store.save("a:///x", entry)
    expect(await store.load("a:///x")).toEqual(entry)
    await store.save("a:///x", null)
    expect(await store.load("a:///x")).toBeNull()
  })
})
