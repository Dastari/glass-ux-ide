// Folds dist/ into one HTML file that opens from disk (a module script cannot be loaded
// from file://, so the JavaScript and CSS have to be inline). Assets are already inlined by
// the assetsInlineLimit in vite.config.ts.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist")
let html = readFileSync(join(dist, "index.html"), "utf8")

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, file) => {
  const css = readFileSync(join(dist, file), "utf8")
  return `<style>${css.replaceAll("</style", "<\\/style")}</style>`
})
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "")
let script = ""
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_, file) => {
  script = readFileSync(join(dist, file), "utf8")
  return ""
})
// Placed last so #root exists when it runs; a replacer function keeps any $ in the bundle.
html = html.replace("</body>", () => `<script type="module">${script.replaceAll("</script", "<\\/script")}</script></body>`)

const out = join(dist, "..", "glass-ux-ide-mockups.html")
writeFileSync(out, html)
console.log(`${out} ${(html.length / 1048576).toFixed(1)} MB`)
