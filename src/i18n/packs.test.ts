import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { defineMessagePack } from "glass-ux/i18n"
import { combineMessagePacks, workbenchMessages, type WorkbenchWords } from "../ui/workbench/messages.ts"

const tags = readdirSync(new URL(".", import.meta.url)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => name.slice(0, -3))
const defaults = workbenchMessages.defaults as Record<string, unknown>

describe("language packs", () => {
  it("covers the same languages as glass-ux", () => {
    expect(tags.sort()).toEqual(["ar", "de", "es", "fr", "he", "it", "ja", "ko", "nl", "pt-BR", "zh-Hans"])
  })

  it.each(tags)("%s translates every word, and nothing else", async (tag) => {
    const { default: pack } = await import(`./${tag}.ts`)
    const words = pack.messages.ideWorkbench as Record<string, unknown>
    expect(Object.keys(words).sort()).toEqual(Object.keys(defaults).sort())
    for (const [key, value] of Object.entries(words)) expect(typeof value, key).toBe(typeof defaults[key])
  })

  it("keeps the values a message is given", async () => {
    const { default: pack } = await import("./de.ts")
    const words = pack.messages.ideWorkbench as WorkbenchWords
    expect(words.saveFailed({ name: "a.ts", reason: "Disk full" })).toBe("a.ts wurde nicht gespeichert: Disk full")
    expect(words.line({ line: "3", column: "4", exact: false })).toBe("≈Z. 3, Sp. 4")
  })

  it("joins with glass-ux's own pack, because a second registration replaces the first", async () => {
    const { default: pack } = await import("./de.ts")
    const glass = defineMessagePack("de", { shell: { searchLabel: "Suchen" } })
    const both = combineMessagePacks(glass, pack)
    expect(Object.keys(both.messages as object).sort()).toEqual(["ideWorkbench", "shell"])
    expect(both.locale).toBe("de")
  })

  it("uses the dual in Arabic", async () => {
    const { default: pack } = await import("./ar.ts")
    const words = pack.messages.ideWorkbench as WorkbenchWords
    expect(words.errors({ count: 2, locale: "ar" })).toBe("خطآن")
    expect(words.errors({ count: 5, locale: "ar" })).toBe("5 أخطاء")
  })
})
