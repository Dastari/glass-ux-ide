// Each layer may import only the layers below it, so the engine stays usable without a DOM,
// without React and without glass-ux. See docs/DESIGN.md, section 3.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const root = "src"
const LAYERS = [
  { name: "core", allows: [], bare: [], tests: ["languages"] },
  { name: "languages", allows: ["core"], bare: [] },
  { name: "backend", allows: ["core"], bare: ["glass-ux/file-provider"] },
  { name: "format", allows: ["core", "languages"], bare: [] },
  { name: "view", allows: ["core", "backend", "languages"], bare: [] },
  { name: "react", allows: ["core", "backend", "languages", "view"], bare: ["react"] },
  { name: "ui", allows: ["core", "backend", "languages", "format", "view", "react"], bare: ["react", "glass-ux"] },
]
const DOM_GLOBALS = /(?<![.\w])(document|window|navigator|localStorage|HTMLElement)\.\w/
const NODE_BUILTIN = /^(node:|fs$|path$)/

function files(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

const failures = []
for (const layer of LAYERS) {
  const folder = join(root, layer.name)
  let paths = []
  try {
    paths = files(folder)
  } catch {
    continue
  }
  for (const path of paths) {
    if (/\.test\.tsx?$/.test(path)) continue
    const source = readFileSync(path, "utf8")
    for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
      if (specifier.startsWith(".")) {
        const target = relative(root, resolve(dirname(path), specifier)).split("/")[0]
        if (target !== layer.name && !layer.allows.includes(target)) failures.push(`${path}: ${layer.name} may not import ${target}`)
      } else if (NODE_BUILTIN.test(specifier) || !layer.bare.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        failures.push(`${path}: ${layer.name} may not import "${specifier}"`)
      }
    }
    if (layer.name === "core") {
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|^(import|export) .* from .*$|^\} from .*$/gm, "")
      const match = DOM_GLOBALS.exec(code)
      if (match) failures.push(`${path}: ${layer.name} may not touch the DOM (${match[0]})`)
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log("Layer boundaries hold.")
