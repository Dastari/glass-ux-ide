/**
 * The Phase 2 gate: the real editor, in a real browser, on a real file. Skipped unless
 * GATE_FILE names one, because a file this size does not belong in the repository.
 */
import { expect, test } from "@playwright/test"

const file = process.env.GATE_FILE

test.describe("gate", () => {
  test.skip(!file, "Set GATE_FILE to a large file")
  test.setTimeout(120_000)

  test("a real large file", async ({ page }) => {
    await page.goto("/?doc=sample")
    await page.locator(".gux-row").first().waitFor()
    const start = Date.now()
    await page.locator("#file").setInputFiles(file!)
    await expect(page.locator(".gux-row").first()).not.toHaveText(/import/, { timeout: 20_000 })
    console.log(`Open to first rows: ${Date.now() - start} ms, including the test harness`)
    const results = await page.evaluate(async () => {
      const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * p)]!
      const scroller = document.querySelector<HTMLElement>(".gux-scroller")!
      const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
      const firstRow = () => document.querySelector(".gux-row")!.textContent

      // Fling: the wheel moves a steady amount each frame.
      const frames: number[] = []
      let last = await nextFrame()
      for (let frame = 0; frame < 240; frame += 1) {
        scroller.scrollTop += 60
        const now = await nextFrame()
        frames.push(now - last)
        last = now
      }

      // Jumps: a scrollbar drag to random places, until new text is on screen.
      const jumps: number[] = []
      for (let round = 0; round < 40; round += 1) {
        const before = firstRow()
        const started = performance.now()
        scroller.scrollTop = 4000 + ((round * 2654435761) % 4294967296) / 4294967296 * (scroller.scrollHeight - 9000)
        while (firstRow() === before && performance.now() - started < 2000) await nextFrame()
        jumps.push(performance.now() - started)
      }

      // Typing: one input event, painted before it returns.
      const input = document.querySelector<HTMLTextAreaElement>(".gux-input")!
      const keys: number[] = []
      for (let round = 0; round < 120; round += 1) {
        const started = performance.now()
        input.value = "x"
        input.dispatchEvent(new InputEvent("input", { bubbles: true }))
        keys.push(performance.now() - started)
        await nextFrame()
      }
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
      return {
        frameP50: percentile(frames, 0.5),
        frameP99: percentile(frames, 0.99),
        slowFrames: frames.filter((value) => value > 25).length,
        jumpP50: percentile(jumps, 0.5),
        jumpP99: percentile(jumps, 0.99),
        keyP50: percentile(keys, 0.5),
        keyP99: percentile(keys, 0.99),
        mainHeapMb: Math.round(memory / 1024 / 1024),
        domNodes: document.querySelectorAll(".gux-editor *").length,
      }
    })
    console.log(JSON.stringify(results, null, 1))
  })
})
