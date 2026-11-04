// Writes a large test file with varied, incompressible lines.
//   node scripts/make-perf-file.mjs <path> <gigabytes> [lines|single]
import { createWriteStream } from "node:fs"
import { once } from "node:events"
import { randomBytes } from "node:crypto"

const [path, gigabytes, shape = "lines"] = process.argv.slice(2)
const target = Number(gigabytes) * 1024 ** 3
const out = createWriteStream(path, { highWaterMark: 16 * 1024 * 1024 })
const LEVELS = ["INFO", "INFO", "INFO", "WARN", "INFO", "ERROR", "DEBUG"]
let written = 0
let line = 0
while (written < target) {
  const noise = randomBytes(4 * 1024 * 1024).toString("base64")
  let chunk = ""
  if (shape === "single") chunk = noise.replaceAll("\n", "")
  else {
    let at = 0
    while (at < noise.length) {
      const length = 40 + (line * 2654435761) % 200
      chunk += `{"line":${line},"level":"${LEVELS[line % LEVELS.length]}","trace":"${noise.slice(at, at + length)}"}\n`
      at += length
      line += 1
    }
  }
  written += Buffer.byteLength(chunk)
  if (!out.write(chunk)) await once(out, "drain")
}
out.end()
await once(out, "finish")
console.log(`${path}: ${(written / 1024 ** 3).toFixed(2)} GB, ${line} lines`)
