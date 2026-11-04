// Renders every mock-up state from the single-file build into shots/.
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const url = pathToFileURL(join(root, "glass-ux-ide-mockups.html")).href
const out = join(root, "shots")
mkdirSync(join(out, "web"), { recursive: true })

const desktop = { width: 1600, height: 1000 }
const SHOTS = [
  ["01-workbench", "workbench", "", desktop],
  ["02-split-hover", "split", "", desktop],
  ["03-huge-file", "huge", "", desktop],
  ["04-history-diff", "history", "", desktop],
  ["05-open-location", "remote", "", desktop],
  ["06-save-conflict", "conflict", "", desktop],
  ["07-command-palette", "palette", "", desktop],
  ["08-inside-an-app", "embed", "", desktop],
  ["09-components", "components", "", desktop],
  ["10-docs-site", "docs", "", desktop],
  ["11-accessibility", "a11y", "", desktop],
  ["12-light", "workbench", "&mode=light", desktop],
  ["13-flat", "workbench", "&style=flat", desktop],
  ["14-arabic-rtl", "split", "&dir=rtl", desktop],
  ["15-phone", "workbench", "", { width: 390, height: 844 }],
  ["16-narrow-pane", "workbench", "", { width: 760, height: 900 }],
  ["17-forced-colours", "workbench", "", desktop, { forcedColors: "active" }],
  ["18-what-runs-where", "backend", "", desktop],
]

const only = process.argv.slice(2)
const browser = await chromium.launch()
const failures = []
for (const [name, screen, query, viewport, extra] of SHOTS) {
  if (only.length && !only.some((item) => name.includes(item))) continue
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, ...extra })
  const page = await context.newPage()
  page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${name}: ${message.text().slice(0, 300)}`)
  })
  await page.goto(`${url}?shot=1${query}#${screen}`)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, `${name}.png`) })
  await page.screenshot({ path: join(out, "web", `${name}.jpg`), type: "jpeg", quality: 74, scale: "css" })
  await context.close()
  console.log(name)
}
await browser.close()
if (failures.length) {
  console.error(failures.join("\n"))
  process.exitCode = 1
}
