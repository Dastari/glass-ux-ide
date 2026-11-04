import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import type { FileProvider } from "glass-ux/file-provider"

interface Lab {
  browserFiles(options: { folder: string }): FileProvider
  memoryFiles(seed: Record<string, string>): FileProvider
  testFileProvider(provider: FileProvider): Promise<{ failed: unknown[]; checks: { status: string }[] }>
  openFile(worker: Worker, provider: FileProvider, uri: string): Promise<{ handle: { edit(edits: object[]): Promise<unknown>; undo(): Promise<unknown>; text(start: number, end: number): Promise<string> }; save(): Promise<unknown> }>
  newWorker(): Worker
  SaveConflictError: new () => Error
}

declare global {
  // eslint-disable-next-line no-var
  var handle: { text(start: number, end: number): Promise<string>; state(): Promise<{ size: number; exactLines: boolean; lineCount: number }> }
  // eslint-disable-next-line no-var
  var editor: { selection: readonly { anchor: number; head: number }[]; refresh(): Promise<void> }
}

const open = async (page: Page, doc = "sample", text?: string) => {
  await page.goto(`/?doc=${doc}${text === undefined ? "" : `&text=${encodeURIComponent(text)}`}`)
  await page.locator(".gux-row").first().waitFor()
  await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "")
}
const documentText = (page: Page) => page.evaluate(() => globalThis.handle.text(0, 1e9))
const settled = async (page: Page, expected: string) => expect.poll(() => documentText(page)).toBe(expected)
const head = (page: Page) => page.evaluate(() => globalThis.editor.selection[0]!.head)
const rowTexts = (page: Page) => page.locator(".gux-row").allInnerTexts()

test.describe("typing", () => {
  test("types, deletes and undoes", async ({ page }) => {
    await open(page, "sample", "")
    await page.keyboard.type("hello world")
    await settled(page, "hello world")
    await page.keyboard.press("Backspace")
    await page.keyboard.press("Backspace")
    await settled(page, "hello wor")
    await page.keyboard.press("Control+z")
    await settled(page, "hello world")
    await page.keyboard.press("Control+z")
    await settled(page, "")
    await page.keyboard.press("Control+y")
    await settled(page, "hello world")
  })

  test("Enter keeps the indent, and Tab indents", async ({ page }) => {
    await open(page, "sample", "")
    await page.keyboard.press("Tab")
    await page.keyboard.type("a")
    await page.keyboard.press("Enter")
    await page.keyboard.type("b")
    await settled(page, "  a\n  b")
    expect(await rowTexts(page)).toContain("  b")
  })

  test("deletes a whole character, not a byte", async ({ page }) => {
    await open(page, "sample", "a日🙂")
    await page.keyboard.press("Control+End")
    await page.keyboard.press("Backspace")
    await settled(page, "a日")
    await page.keyboard.press("Backspace")
    await settled(page, "a")
  })

  test("types into the middle of a line it has moved to", async ({ page }) => {
    await open(page, "sample", "one\ntwo\nthree")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("End")
    await page.keyboard.type("!")
    await settled(page, "one\ntwo!\nthree")
  })

  test("composes with an input method", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Needs the DevTools protocol")
    await open(page, "sample", "ab")
    await page.keyboard.press("Control+End")
    const client = await page.context().newCDPSession(page)
    await client.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 })
    await client.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 })
    await client.send("Input.insertText", { text: "日本" })
    await settled(page, "ab日本")
    await expect.poll(() => head(page)).toBe(8)
  })
})

test.describe("selection and movement", () => {
  test("selects with the keyboard and replaces", async ({ page }) => {
    await open(page, "sample", "one two")
    await page.keyboard.press("Control+Home")
    await page.keyboard.press("Shift+ArrowRight")
    await page.keyboard.press("Shift+ArrowRight")
    await page.keyboard.press("Shift+ArrowRight")
    await expect(page.locator(".gux-selection-rect")).toHaveCount(1)
    await page.keyboard.type("1")
    await settled(page, "1 two")
  })

  test("moves by word", async ({ page }) => {
    await open(page, "sample", "alpha beta gamma")
    await page.keyboard.press("Control+Home")
    await page.keyboard.press("Control+ArrowRight")
    await expect.poll(() => head(page)).toBe(5)
    await page.keyboard.press("Control+ArrowRight")
    await expect.poll(() => head(page)).toBe(10)
    await page.keyboard.press("Control+ArrowLeft")
    await expect.poll(() => head(page)).toBe(6)
  })

  test("keeps its column through a short line", async ({ page }) => {
    await open(page, "sample", "long line\nx\nlong line")
    await page.keyboard.press("Control+Home")
    await page.keyboard.press("End")
    await page.keyboard.press("ArrowDown")
    await expect.poll(() => head(page)).toBe(11)
    await page.keyboard.press("ArrowDown")
    await expect.poll(() => head(page)).toBe(21)
  })

  test("Home goes to the text, then the row", async ({ page }) => {
    await open(page, "sample", "    indented")
    await page.keyboard.press("Control+End")
    await page.keyboard.press("Home")
    await expect.poll(() => head(page)).toBe(4)
    await page.keyboard.press("Home")
    await expect.poll(() => head(page)).toBe(0)
  })

  test("places the caret by clicking, past wide characters", async ({ page }) => {
    await open(page, "sample", "日本語abc\nsecond")
    const row = page.locator(".gux-row").first()
    const range = await row.evaluate((node) => {
      const text = node.firstChild!
      const span = document.createRange()
      span.setStart(text, 3)
      span.setEnd(text, 4)
      const box = span.getBoundingClientRect()
      return { x: box.left + 1, y: box.top + box.height / 2 }
    })
    await page.mouse.click(range.x, range.y)
    await expect.poll(() => head(page)).toBe(9)
  })

  test("drags a selection", async ({ page }) => {
    await open(page, "sample", "one two three")
    const box = (await page.locator(".gux-row").first().boundingBox())!
    await page.mouse.move(box.x + 1, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 8, { steps: 4 })
    await page.mouse.up()
    const selection = await page.evaluate(() => globalThis.editor.selection[0]!)
    expect(selection.anchor).toBe(0)
    expect(selection.head).toBe(13)
  })

  test("types at several carets", async ({ page }) => {
    await open(page, "sample", "aaa\nbbb\nccc")
    const rows = page.locator(".gux-row")
    const first = (await rows.nth(0).boundingBox())!
    await page.mouse.click(first.x + 1, first.y + 8)
    const third = (await rows.nth(2).boundingBox())!
    await page.keyboard.down("Alt")
    await page.mouse.click(third.x + 1, third.y + 8)
    await page.keyboard.up("Alt")
    await expect(page.locator(".gux-caret")).toHaveCount(2)
    await page.keyboard.type("x")
    await settled(page, "xaaa\nbbb\nxccc")
  })
})

test.describe("hidden and shown again", () => {
  test("repaints its rows, as a background tab does", async ({ page }) => {
    await open(page, "sample", "one\ntwo\nthree")
    await page.locator("#editor").evaluate((node) => ((node as HTMLElement).style.display = "none"))
    await page.waitForTimeout(100)
    await page.locator("#editor").evaluate((node) => ((node as HTMLElement).style.display = ""))
    await expect.poll(async () => (await rowTexts(page)).filter(Boolean)).toEqual(["one", "two", "three"])
  })
})

test.describe("highlighting", () => {
  test("colours code and carries comments between lines", async ({ page }) => {
    await open(page)
    await expect(page.locator('[data-tok="keyword"]', { hasText: "import" })).toBeVisible()
    await expect(page.locator('[data-tok="comment"]', { hasText: "runs across lines." })).toBeVisible()
  })

  test("updates as you type", async ({ page }) => {
    await open(page, "sample", "")
    await page.keyboard.type("const")
    await expect(page.locator('[data-tok="keyword"]', { hasText: "const" })).toBeVisible()
  })
})

test.describe("huge documents", () => {
  test("opens 100 GB and shows the first screen", async ({ page }) => {
    await open(page, "huge")
    expect(await page.evaluate(async () => (await globalThis.handle.state()).size)).toBe(100 * 1024 ** 3)
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000000')
  })

  test("the DOM does not grow with the document", async ({ page }) => {
    await open(page, "huge")
    expect(await page.locator(".gux-editor *").count()).toBeLessThan(200)
  })

  test("goes to the end, types there and comes back", async ({ page }) => {
    await open(page, "huge")
    await page.keyboard.press("Control+End")
    await expect.poll(() => head(page)).toBe(100 * 1024 ** 3)
    await page.keyboard.type("end")
    await expect(page.locator(".gux-row", { hasText: "end" }).first()).toBeVisible()
    await page.keyboard.press("Control+Home")
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000000')
  })

  test("wheel scrolling moves row by row", async ({ page }) => {
    await open(page, "huge")
    const editor = (await page.locator(".gux-editor").boundingBox())!
    await page.mouse.move(editor.x + 300, editor.y + 200)
    await page.mouse.wheel(0, 44 * 5)
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000010')
  })

  test("scrolling down a little can be scrolled back up", async ({ page }) => {
    await open(page, "huge")
    const editor = (await page.locator(".gux-editor").boundingBox())!
    await page.mouse.move(editor.x + 300, editor.y + 200)
    await page.mouse.wheel(0, 44 * 5)
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000010')
    // Long enough for the scrollbar to settle, which is what used to strand it at the top.
    await page.waitForTimeout(400)
    await page.mouse.wheel(0, -44 * 2)
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000006')
    await page.waitForTimeout(400)
    await page.mouse.wheel(0, -44 * 20)
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000000')
  })

  test("a scrollbar dragged to the ends reaches the ends", async ({ page }) => {
    await open(page, "huge")
    await page.evaluate(() => {
      const scroller = document.querySelector(".gux-scroller")!
      scroller.scrollTop = scroller.scrollHeight
    })
    await expect.poll(async () => (await rowTexts(page))[0]).toMatch(/"line":00008388/)
    await page.evaluate(() => {
      document.querySelector(".gux-scroller")!.scrollTop = 0
    })
    await expect(page.locator(".gux-row").first()).toContainText('{"line":0000000000000')
  })

  test("dragging the scrollbar jumps to the matching place", async ({ page }) => {
    await open(page, "huge")
    await page.evaluate(() => {
      const scroller = document.querySelector(".gux-scroller")!
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2
    })
    await expect.poll(async () => (await rowTexts(page))[0]).toMatch(/"line":0000(41|42)/)
  })

  test("estimates line numbers until it is indexed", async ({ page }) => {
    await open(page, "huge")
    await page.keyboard.press("Control+End")
    await expect(page.locator(".gux-gutter > div", { hasText: "≈8388608" }).first()).toBeVisible()
  })

  test("a three megabyte line renders in bounded rows", async ({ page }) => {
    await open(page, "hostile")
    const lengths = (await rowTexts(page)).map((row) => row.length).filter(Boolean)
    expect(lengths.length).toBeGreaterThan(1)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(16 * 1024)
    await page.keyboard.press("Control+End")
    await page.keyboard.type("!")
    await expect.poll(async () => (await page.evaluate(() => globalThis.handle.state())).size).toBe(3_000_001)
  })

  test("keystroke to paint stays within a frame on a huge document", async ({ page }) => {
    await open(page, "huge")
    await page.keyboard.press("Control+End")
    await expect(page.locator(".gux-row[data-current]")).toHaveText("")
    const samples = await page.evaluate(async () => {
      const input = document.querySelector<HTMLTextAreaElement>(".gux-input")!
      const row = () => document.querySelector(".gux-row[data-current]")!
      const times: number[] = []
      for (let round = 0; round < 100; round += 1) {
        const before = row().textContent
        const start = performance.now()
        input.value = "x"
        input.dispatchEvent(new InputEvent("input", { bubbles: true }))
        // Painted before the event returned, or it did not happen on this frame.
        if (row().textContent === before) throw new Error("The keystroke did not paint synchronously")
        times.push(performance.now() - start)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return times.sort((a, b) => a - b)
    })
    const p99 = samples[98]!
    console.log(`Keystroke to DOM update: median ${samples[50]!.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms`)
    expect(p99).toBeLessThan(16)
  })
})

test.describe("files through a provider", () => {
  test("the browser file provider passes the glass-ux conformance suite", async ({ page, browserName }) => {
    // Playwright's WebKit refuses every write to the private file system with "an unknown transient
    // reason". Safari itself has not been tried.
    test.fixme(browserName === "webkit", "WebKit under Playwright cannot write to the origin private file system")
    await open(page)
    const failed = await page.evaluate(async () => {
      const { lab } = globalThis as never as { lab: Lab }
      const provider = lab.browserFiles({ folder: `conformance-${Date.now()}` })
      const report = await lab.testFileProvider(provider)
      return { failed: report.failed, passed: report.checks.filter((check) => check.status === "passed").length }
    })
    expect(failed.failed).toEqual([])
    expect(failed.passed).toBeGreaterThan(5)
  })

  test("opens, edits and saves through a worker, then holds a conflicting save", async ({ page }) => {
    await open(page)
    const result = await page.evaluate(async () => {
      const { lab } = globalThis as never as { lab: Lab }
      const signal = new AbortController().signal
      const uri = "memory:///big.txt"
      const provider = lab.memoryFiles({ "big.txt": `${"line\n".repeat(50_000)}end\n` })
      const reads = { count: 0, bytes: 0 }
      const counted = { ...provider, read: (...args: Parameters<typeof provider.read>) => ((reads.count += 1), (reads.bytes += args[1].length), provider.read(...args)) }
      const opened = await lab.openFile(lab.newWorker(), counted, uri)
      await opened.handle.edit([{ start: 0, end: 4, text: "LINE" }])
      await opened.save()
      const first = new TextDecoder().decode(await provider.read(uri, { offset: 0, length: 9 }, { signal }))
      await opened.handle.edit([{ start: 0, end: 0, text: "x" }])
      const stream = new Blob(["changed elsewhere"]).stream()
      await provider.write!(uri, stream, { base: { overwrite: true }, signal })
      const conflict = await opened.save().then(() => "saved", (error: unknown) => (error instanceof lab.SaveConflictError ? "conflict" : String(error)))
      const kept = await opened.handle.text(0, 5)
      await opened.handle.undo()
      await opened.handle.undo()
      const undone = await opened.handle.text(0, 4)
      return { first, conflict, kept, undone }
    })
    expect(result).toEqual({ first: "LINE\nline", conflict: "conflict", kept: "xLINE", undone: "line" })
  })
})

test.describe("accessibility", () => {
  test("axe finds nothing in the editor", async ({ page }) => {
    await open(page)
    const results = await new AxeBuilder({ page }).include(".gux-editor").analyze()
    expect(results.violations.map((item) => `${item.id}: ${item.help}`)).toEqual([])
  })

  test("the input is labelled and is the only thing exposed", async ({ page }) => {
    await open(page)
    await expect(page.getByRole("textbox", { name: "sample document" })).toBeFocused()
    await expect(page.locator(".gux-content")).toHaveAttribute("aria-hidden", "true")
  })

  test("Ctrl+M lets Tab leave the editor", async ({ page }) => {
    await open(page, "sample", "")
    await page.keyboard.press("Control+m")
    await page.keyboard.press("Tab")
    await expect(page.locator("#after")).toBeFocused()
    await settled(page, "")
  })

  test("a screen reader gets the current line", async ({ page }) => {
    await page.goto(`/?doc=sample&reader&text=${encodeURIComponent("first\nsecond")}`)
    await page.locator(".gux-row").first().waitFor()
    await expect(page.locator(".gux-input")).toHaveValue("first")
    await page.keyboard.press("ArrowDown")
    await expect(page.locator(".gux-input")).toHaveValue("second")
    await page.keyboard.press("End")
    await page.keyboard.type("!")
    await settled(page, "first\nsecond!")
  })
})
