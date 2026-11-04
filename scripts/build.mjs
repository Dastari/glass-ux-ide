// Builds the package: readable ESM and declarations, with stylesheets beside their components.
import { execFileSync } from "node:child_process"
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

rmSync("dist", { recursive: true, force: true })
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" })

const files = (folder) => readdirSync(folder).flatMap((name) => {
  const path = join(folder, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

for (const path of files("src")) {
  if (path.endsWith(".css") && !path.includes("gallery")) {
    const target = join("dist", relative("src", path))
    cpSync(path, target)
  }
}

// The worker is found by URL, which the compiler cannot see is a module path.
for (const path of files("dist")) {
  if (!path.endsWith(".js")) continue
  const source = readFileSync(path, "utf8")
  const next = source.replaceAll('document-worker.ts"', 'document-worker.js"')
  if (next !== source) writeFileSync(path, next)
}
// Declarations describe types: a stylesheet import there breaks a consumer's typecheck.
for (const path of files("dist")) {
  if (!path.endsWith(".d.ts")) continue
  const source = readFileSync(path, "utf8")
  const next = source.replace(/^import "[^"]+\.css";\n/gm, "")
  if (next !== source) writeFileSync(path, next)
}
console.log(`Built ${files("dist").length} files in ${dirname("dist/x")}.`)
