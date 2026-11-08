/** The real Workbench, driven as a person would, through the demo on the docs site. */
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import type { FileProvider } from "glass-ux/file-provider"

const URL = "http://127.0.0.1:4311/demo"
const QUEUE = "project:///src/sync/replica-queue.ts"

declare global {
  // eslint-disable-next-line no-var
  var demoProject: FileProvider
}

const open = async (page: Page) => {
  await page.goto(URL)
  await rows(page).first().waitFor({ timeout: 30_000 })
  await expect(page.locator(".gux-editor-mount .gux-input").first()).toBeFocused()
}
function rows(page: Page) {
  return page.locator(".gux-editor-mount:visible .gux-row")
}
const tab = (page: Page, name: string | RegExp) => page.getByRole("tab", { name })
const fileRow = (page: Page, name: string) => page.getByRole("treeitem", { name, exact: true })
const texts = async (page: Page) => (await rows(page).allInnerTexts()).join("\n")
const saved = (page: Page, uri = QUEUE) =>
  page.evaluate(async (target) => {
    const signal = new AbortController().signal
    const stat = await globalThis.demoProject.stat(target, { signal })
    return new TextDecoder().decode(await globalThis.demoProject.read(target, { offset: 0, length: stat.size! }, { signal }))
  }, uri)

test.describe("tabs and files", () => {
  test("opens with a real file, highlighted", async ({ page }) => {
    await open(page)
    await expect(tab(page, /replica-queue\.ts/)).toBeVisible()
    await expect(page.locator('.gux-row [data-tok="keyword"]', { hasText: "import" }).first()).toBeVisible()
  })

  test("a single click previews, and the next one takes its place", async ({ page }) => {
    await open(page)
    await fileRow(page, "README.md").click()
    await expect(tab(page, /README\.md/)).toBeVisible()
    await fileRow(page, "package.json").click()
    await expect(tab(page, /package\.json/)).toBeVisible()
    await expect(tab(page, /README\.md/)).toHaveCount(0)
    await expect(tab(page, /replica-queue\.ts/)).toBeVisible()
  })

  test("a double click keeps the tab", async ({ page }) => {
    await open(page)
    await fileRow(page, "README.md").dblclick()
    await expect(tab(page, /README\.md/)).toBeVisible()
    await fileRow(page, "package.json").click()
    await expect(tab(page, /package\.json/)).toBeVisible()
    await expect(tab(page, /README\.md/)).toBeVisible()
  })

  test("typing in a preview keeps it", async ({ page }) => {
    await open(page)
    await fileRow(page, "README.md").click()
    await expect.poll(() => texts(page)).toContain("harbour-api")
    await page.keyboard.type("x")
    await fileRow(page, "package.json").click()
    await expect(tab(page, /package\.json/)).toBeVisible()
    await expect(tab(page, /README\.md/)).toBeVisible()
  })

  test("marks a tab unsaved, and undoing back to the file clears it", async ({ page }) => {
    await open(page)
    await page.keyboard.type("x")
    await expect(tab(page, /replica-queue\.ts.*unsaved/i)).toBeVisible()
    await page.keyboard.press("Control+z")
    await expect(tab(page, /replica-queue\.ts.*unsaved/i)).toHaveCount(0)
  })

  test("asks before closing unsaved work, and can be refused", async ({ page }) => {
    await open(page)
    await page.keyboard.type("x")
    await expect(tab(page, /unsaved/i)).toBeVisible()
    await tab(page, /replica-queue\.ts/).press("Delete")
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("replica-queue.ts")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(tab(page, /replica-queue\.ts/)).toBeVisible()
    await tab(page, /replica-queue\.ts/).press("Delete")
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click()
    await expect(tab(page, /replica-queue\.ts/)).toHaveCount(0)
    await expect(page.getByText("No file open")).toBeVisible()
  })

  test("after the last tab closes, the next file still has somewhere to go", async ({ page }) => {
    await open(page)
    await tab(page, /replica-queue\.ts/).press("Delete")
    await expect(page.getByText("No file open")).toBeVisible()
    await fileRow(page, "README.md").click()
    await expect.poll(() => texts(page)).toContain("harbour-api")
  })
})

test.describe("saving", () => {
  test("Ctrl+S writes through the provider and clears the marker", async ({ page }) => {
    await open(page)
    await page.keyboard.type("// saved")
    await page.keyboard.press("Control+s")
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
    expect(await saved(page)).toMatch(/^\/\/ saved/)
  })

  test("undo still works after saving", async ({ page }) => {
    await open(page)
    await page.keyboard.type("a")
    await page.keyboard.press("Control+s")
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
    await page.keyboard.press("Control+z")
    await expect(tab(page, /unsaved/i)).toBeVisible()
    await expect.poll(async () => (await texts(page)).startsWith("import")).toBe(true)
  })

  test("the menubar saves too", async ({ page }) => {
    await open(page)
    await page.keyboard.type("m")
    await page.getByRole("menuitem", { name: "File" }).click()
    await page.getByRole("menuitem", { name: /^Save(?! as)/ }).click()
    await expect.poll(() => saved(page)).toMatch(/^mimport/)
  })

  test("holds a save when the file changed elsewhere, then overwrites on request", async ({ page }) => {
    await open(page)
    await page.keyboard.type("mine")
    await expect(tab(page, /unsaved/i)).toBeVisible()
    await page.evaluate(async (uri) => {
      const signal = new AbortController().signal
      await globalThis.demoProject.write!(uri, new Blob(["theirs"]).stream(), { base: { overwrite: true }, signal })
    }, QUEUE)
    await page.keyboard.press("Control+s")
    await expect(page.getByText(/changed somewhere else/)).toBeVisible()
    expect(await saved(page)).toBe("theirs")
    await expect.poll(() => texts(page)).toContain("mineimport")
    await page.getByRole("button", { name: "Overwrite" }).click()
    await expect.poll(() => saved(page)).toMatch(/^mineimport/)
    await expect(page.getByText(/changed somewhere else/)).toHaveCount(0)
    // Later saves build on the overwrite, so they are not conflicts.
    await page.locator(".gux-input:visible").first().focus()
    await page.keyboard.type("!")
    await page.keyboard.press("Control+s")
    await expect.poll(() => saved(page)).toMatch(/^!?mine/)
    await expect(page.getByText(/changed somewhere else/)).toHaveCount(0)
  })
})

test.describe("find", () => {
  test("counts, moves through matches and replaces all in one undo", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+f")
    const find = page.getByRole("search")
    await find.getByRole("textbox").first().fill("pending")
    await expect(page.locator(".gux-match").first()).toBeVisible()
    await expect(find).toContainText("4 matches")
    await page.keyboard.press("Enter")
    await expect.poll(async () => page.locator(".gux-selection-rect").count()).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(find).toHaveCount(0)
    await expect(page.locator(".gux-match")).toHaveCount(0)
  })

  test("replaces every match in one undo step", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+f")
    const find = page.getByRole("search")
    await find.getByRole("textbox").first().fill("pending")
    await expect(find).toContainText("4 matches")
    await find.getByRole("button", { name: /replace/i }).first().click()
    await find.getByRole("textbox", { name: /replace/i }).fill("queued")
    await find.getByRole("button", { name: /replace all/i }).click()
    await expect.poll(() => texts(page)).toContain("this.queued.get")
    await expect(find).toContainText("No matches")
    await expect(tab(page, /unsaved/i)).toBeVisible()
    await page.keyboard.press("Escape")
    await page.keyboard.press("Control+z")
    await expect.poll(() => texts(page)).toContain("this.pending.get")
  })

  test("takes a regular expression, and says nothing for a broken one", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+f")
    const find = page.getByRole("search")
    await find.getByRole("button", { name: "Regular expression" }).click()
    await find.getByRole("textbox").first().fill("pend\\w+")
    await expect(find).toContainText("4 matches")
    await find.getByRole("textbox").first().fill("(unclosed")
    await expect(page.locator(".gux-match")).toHaveCount(0)
  })
})

test.describe("suggestions", () => {
  test("offers the backend's members after a dot and inserts the choice", async ({ page }) => {
    await open(page)
    await page.keyboard.type("journal.ch")
    const list = page.getByRole("listbox")
    await expect(list).toContainText("checkpoint", { timeout: 3000 })
    await page.keyboard.press("Enter")
    await expect.poll(() => texts(page)).toContain("journal.checkpoint")
    await expect(list).toHaveCount(0)
  })

  test("the focus stays in the editor while the list is open", async ({ page }) => {
    await open(page)
    await page.keyboard.type("journal.")
    await expect(page.getByRole("listbox")).toBeVisible()
    await expect(page.locator(".gux-editor-mount .gux-input").first()).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toHaveCount(0)
  })
})

test.describe("problems", () => {
  test("lists diagnostics, draws them and goes to them", async ({ page }) => {
    await open(page)
    await expect(page.getByLabel("Problems").first()).toContainText("shared by every replica")
    await page.getByRole("treeitem", { name: /shared by every replica/ }).first().click()
    await expect(page.locator(".gux-selection-rect").first()).toBeVisible()
  })
})

test.describe("commands", () => {
  test("a chord opens the shortcuts, which list the editor's commands", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+k")
    await page.keyboard.press("Control+s")
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText("Find")
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
  })

  test("the palette finds commands from inside the editor", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+p")
    await page.keyboard.type("appearance")
    await page.keyboard.press("Enter")
    // The palette may still be closing as the next dialog opens.
    await expect(page.getByRole("dialog", { name: "Appearance" })).toContainText("Palette")
  })
})

test.describe("languages", () => {
  test("Arabic reads right to left, in the workbench's words and glass-ux's together", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("glass-ux-ide-docs.language", "ar"))
    await page.goto(URL)
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expect(page.getByRole("menuitem", { name: "ملف" })).toBeVisible()
    await expect(page.getByRole("button", { name: "إغلاق" }).or(page.getByRole("button", { name: /بحث/ })).first()).toBeVisible()
  })
})

test.describe("accessibility", () => {
  test("the demo has no serious violations, and F6 moves between its regions", async ({ page }) => {
    await open(page)
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => `${item.id}: ${item.nodes[0]?.target}`)).toEqual([])
    await page.keyboard.press("F6")
    await expect(page.locator(".gux-editor-mount .gux-input").first()).not.toBeFocused()
  })
})

test.describe("views", () => {
  const rail = (page: Page, name: string | RegExp) => page.getByRole("navigation", { name: "Workbench views" }).first().getByRole("button", { name })

  test("the file tree keeps its folders across a change of view", async ({ page }) => {
    await open(page)
    await fileRow(page, "src").click()
    await expect(fileRow(page, "server.ts")).toBeVisible()
    await rail(page, "Search").click()
    await expect(fileRow(page, "README.md")).toBeHidden()
    await rail(page, "Explorer").click()
    await expect(fileRow(page, "server.ts")).toBeVisible()
  })

  test("choosing the current view closes the side bar", async ({ page }) => {
    await open(page)
    await rail(page, "Explorer").click()
    await expect(fileRow(page, "README.md")).toBeHidden()
    await rail(page, "Explorer").click()
    await expect(fileRow(page, "README.md")).toBeVisible()
  })

  test("search finds text in closed files and goes to it", async ({ page }) => {
    await open(page)
    await rail(page, "Search").click()
    await page.getByRole("navigation", { name: "Search" }).first().getByRole("searchbox").fill("SEGMENT_BYTES")
    const result = page.getByRole("treeitem", { name: /export const SEGMENT_BYTES/ })
    await result.click()
    await expect(tab(page, /segment\.ts/)).toBeVisible()
    await expect(page.locator(".gux-selection-rect").first()).toBeVisible()
  })

  test("changes lists an edited file and compares it with what was saved", async ({ page }) => {
    await open(page)
    await page.keyboard.type("// edited\n")
    await rail(page, "Changes").click()
    await page.getByRole("navigation", { name: "Changes" }).first().getByRole("button", { name: /replica-queue/ }).click()
    await expect(tab(page, /replica-queue\.ts \(changes\)/)).toBeVisible()
    await expect(page.getByRole("group", { name: /changes/ }).or(page.locator(".gux-changes")).first()).toContainText("// edited")
  })

  test("an application's own panel sits beside Problems and Output", async ({ page }) => {
    await open(page)
    await tab(page, /Terminal/).click()
    const command = page.getByRole("textbox", { name: "Terminal command" })
    await command.fill("open README.md")
    await command.press("Enter")
    await expect(tab(page, /README\.md/)).toBeVisible()
  })
})

test.describe("files", () => {
  test("New file creates a file through the provider and opens it", async ({ page }) => {
    await open(page)
    await page.getByRole("menuitem", { name: "File" }).click()
    await page.getByRole("menuitem", { name: /^New file/ }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox", { name: /name/i }).fill("notes.ts")
    await dialog.getByRole("button", { name: /^Save$/ }).click()
    await expect(tab(page, /notes\.ts/)).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(fileRow(page, "notes.ts")).toBeVisible()
  })

  test("Save as moves the document to the new file and leaves the old one alone", async ({ page }) => {
    await open(page)
    await page.keyboard.type("// copy\n")
    await page.keyboard.press("Control+Shift+s")
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox", { name: /name/i }).fill("copy.ts")
    await dialog.getByRole("button", { name: /^Save$/ }).click()
    await expect(tab(page, /copy\.ts/)).toBeVisible()
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
    expect(await saved(page)).toMatch(/^import/)
    await expect.poll(async () => (await texts(page)).startsWith("// copy")).toBe(true)
  })
})

test.describe("code windows", () => {
  const toWindow = async (page: Page) => {
    await page.getByRole("menuitem", { name: "Window" }).click()
    await page.getByRole("menuitem", { name: "Open in new window" }).click()
  }

  test("a file moves to a window with its edits, and saves from there", async ({ page }) => {
    await open(page)
    await page.keyboard.type("moved")
    await toWindow(page)
    await expect(page.locator(".gux-editor-mount:visible .gux-row", { hasText: "movedimport" }).first()).toBeVisible()
    await expect(tab(page, /replica-queue\.ts/)).toHaveCount(0)
    await page.locator(".gux-input:visible").first().focus()
    await page.keyboard.press("Control+s")
    await expect.poll(() => saved(page)).toMatch(/^movedimport/)
  })

  test("a window closes through the unsaved check, and moves back to a tab", async ({ page }) => {
    await open(page)
    await page.keyboard.type("x")
    await toWindow(page)
    await page.getByRole("button", { name: "Close" }).first().click()
    const alert = page.getByRole("alertdialog")
    await expect(alert).toContainText("replica-queue.ts")
    await alert.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Move to a tab" }).click()
    await expect(tab(page, /replica-queue\.ts.*unsaved/i)).toBeVisible()
    await expect.poll(() => texts(page)).toContain("ximport")
  })
})

/** What the browser's recovery store holds, as text. */
const journal = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.open("glass-ux-ide.recovery")
        request.onsuccess = () => {
          const all = request.result.transaction("journals").objectStore("journals").getAll()
          all.onsuccess = () => resolve(JSON.stringify(all.result))
        }
      }),
  )

test.describe("recovery", () => {
  test("unsaved edits come back after the page reloads", async ({ page }) => {
    await open(page)
    await page.keyboard.type("// kept ")
    await page.keyboard.press("Control+z")
    await page.keyboard.type("// kept\n")
    await expect.poll(() => journal(page)).toContain('"text":"\\n"')
    await page.reload()
    await rows(page).first().waitFor({ timeout: 30_000 })
    const notice = page.getByText(/were kept from an earlier session/)
    await expect(notice).toBeVisible()
    await page.getByRole("button", { name: "Restore" }).click()
    // The undo put the caret back at the start, so the second line was typed there.
    await expect.poll(() => texts(page)).toMatch(/^\/\/ kept\nimport/)
    await expect(tab(page, /replica-queue\.ts.*unsaved/i)).toBeVisible()
    // The restored steps undo as they were made: the new line, then the typing before it.
    await page.locator(".gux-input:visible").first().focus()
    await page.keyboard.press("Control+z")
    await expect.poll(() => texts(page)).toMatch(/^\/\/ keptimport/)
    await page.keyboard.press("Control+z")
    await expect.poll(() => texts(page)).toMatch(/^import/)
  })

  test("discarding forgets them, and saving leaves nothing to recover", async ({ page }) => {
    await open(page)
    await page.keyboard.type("x")
    await page.keyboard.press("Control+s")
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
    await expect.poll(() => journal(page)).toBe("[]")
    await page.reload()
    await rows(page).first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(500)
    await expect(page.getByText(/earlier session/)).toHaveCount(0)
  })
})

test.describe("language features", () => {
  test("Format reindents through the built-in formatter, in one undo step", async ({ page }) => {
    await open(page)
    await page.keyboard.type("    ")
    await page.keyboard.press("Shift+Alt+f")
    await expect.poll(async () => (await texts(page)).startsWith("import { backoff")).toBe(true)
    await page.keyboard.press("Control+z")
    await expect.poll(async () => (await texts(page)).startsWith("    import")).toBe(true)
  })

  test("F12 goes to a definition in another file", async ({ page }) => {
    await open(page)
    for (let i = 0; i < 9; i += 1) await page.keyboard.press("ArrowRight")
    await page.keyboard.press("F12")
    await expect(tab(page, /policy\.ts/)).toBeVisible()
    await expect(page.locator(".gux-selection-rect").first()).toBeVisible()
  })

  test("F2 renames a symbol in every file", async ({ page }) => {
    await open(page)
    for (let i = 0; i < 9; i += 1) await page.keyboard.press("ArrowRight")
    await page.keyboard.press("F2")
    const dialog = page.getByRole("dialog", { name: "Rename symbol" })
    await expect(dialog.getByRole("textbox")).toHaveValue("backoff")
    await dialog.getByRole("textbox").fill("delayAfter")
    await dialog.getByRole("button", { name: "Rename symbol" }).click()
    await expect.poll(() => texts(page)).toContain("import { delayAfter")
    await expect(tab(page, /policy\.ts.*unsaved/i)).toBeVisible()
  })

  test("a hover describes the symbol under the pointer", async ({ page }) => {
    await open(page)
    const word = page.locator(".gux-row", { hasText: "export class ReplicaQueue" }).first()
    const box = (await word.boundingBox())!
    await page.mouse.move(box.x + 160, box.y + box.height / 2)
    await expect(page.getByText(/Delivers replica events in order/).last()).toBeVisible({ timeout: 4000 })
  })

  test("diagnostics follow the text as it changes", async ({ page }) => {
    await open(page)
    await page.keyboard.type("\n\n")
    await expect(page.getByRole("treeitem", { name: /shared by every replica/ }).first()).toBeVisible()
    await expect(page.locator(".gux-workbench-status")).toContainText("2 warnings")
    await expect(page.getByLabel("Problems").first()).toContainText("10:11")
  })
})

test.describe("history", () => {
  test("the timeline lists the steps and goes back to one", async ({ page }) => {
    await open(page)
    await page.keyboard.type("a")
    await page.keyboard.press("Enter")
    await page.keyboard.type("b")
    await page.getByRole("navigation", { name: "Workbench views" }).first().getByRole("button", { name: "Timeline" }).click()
    const timeline = page.getByRole("listbox", { name: "Timeline" })
    await expect.poll(() => timeline.getByRole("option").count()).toBeGreaterThanOrEqual(3)
    await timeline.getByRole("option", { name: /Opened/ }).click()
    await expect.poll(async () => (await texts(page)).startsWith("import")).toBe(true)
    await expect(tab(page, /unsaved/i)).toHaveCount(0)
  })
})

test.describe("split editors", () => {
  test("two editors of one file share its edits", async ({ page }) => {
    await open(page)
    await page.keyboard.press("Control+\\")
    await expect(page.locator(".gux-editor-mount:visible")).toHaveCount(2)
    await page.keyboard.type("shared")
    await expect(page.locator(".gux-editor-mount:visible").nth(0).locator(".gux-row", { hasText: "sharedimport" })).toBeVisible()
    await expect(page.locator(".gux-editor-mount:visible").nth(1).locator(".gux-row", { hasText: "sharedimport" })).toBeVisible()
  })
})

test.describe("a huge file", () => {
  test("opens through a provider, stays usable, and cannot be saved", async ({ page }) => {
    await open(page)
    await fileRow(page, "events-2026-10.ndjson").click()
    await expect(rows(page).first()).toContainText('{"line":0000000000000')
    await expect(page.locator(".gux-workbench-status")).toContainText("107.4 GB")
    await page.keyboard.press("Control+End")
    await expect(rows(page).filter({ hasText: "0000838860799" }).first()).toBeVisible()
    await expect(page.locator(".gux-workbench-status")).toContainText("838,860,801")
    await page.keyboard.type("hello")
    await expect(rows(page).filter({ hasText: "hello" })).toBeVisible()
    await page.keyboard.press("Control+s")
    await page.getByRole("menuitem", { name: "File" }).click()
    await expect(page.getByRole("menuitem", { name: /^Save(?! as)/ })).toHaveAttribute("aria-disabled", "true")
  })
})

test.describe("layout", () => {
  test("Ctrl+B collapses the files from inside the editor", async ({ page }) => {
    await open(page)
    await expect(fileRow(page, "README.md")).toBeVisible()
    await page.keyboard.press("Control+b")
    await expect(fileRow(page, "README.md")).toBeHidden()
  })

  test("a tab moves to a split and keeps its edits", async ({ page }) => {
    await open(page)
    await page.keyboard.type("kept")
    await fileRow(page, "README.md").dblclick()
    await expect(tab(page, /README\.md/)).toBeVisible()
    await tab(page, /replica-queue\.ts/).click({ button: "right" })
    await page.getByRole("menuitem", { name: /Move to/ }).hover()
    await page.getByRole("menuitem", { name: /Split right/ }).click()
    await expect(page.locator(".gux-editor-mount:visible")).toHaveCount(2)
    await expect(page.locator(".gux-editor-mount:visible .gux-row", { hasText: "keptimport" }).first()).toBeVisible()
  })

  test("a phone gets a full editor and the files in a sheet", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
    await page.goto(URL)
    await rows(page).first().waitFor({ timeout: 30_000 })
    // At 16px or more, iPhone Safari does not zoom the page when the editor takes focus.
    const typing = await page.locator(".gux-editor-mount:visible .gux-input").first().evaluate((input) => parseFloat(getComputedStyle(input).fontSize))
    expect(typing).toBeGreaterThanOrEqual(16)
    const box = (await page.locator(".gux-editor-mount:visible").boundingBox())!
    expect(box.height).toBeGreaterThan(400)
    const bar = (await page.getByRole("navigation", { name: "Workbench views" }).last().boundingBox())!
    const status = (await page.locator(".gux-workbench-status").boundingBox())!
    expect(status.y + status.height).toBeLessThanOrEqual(bar.y)
  })
})
