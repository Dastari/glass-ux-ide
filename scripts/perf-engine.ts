/**
 * Measures the engine against the targets in docs/DESIGN.md, section 17. Without arguments it uses
 * a synthetic 100 GB file. Given a path, it measures a real file, which is the only honest figure
 * for read and index throughput: the synthetic source's speed is the generator's, not the disk's.
 *
 *   pnpm perf:engine                 synthetic, index skipped past 16 GB
 *   pnpm perf:engine /path/to/file   a real file
 */
import { open, stat } from "node:fs/promises"
import { syntheticSource, TextDocument, type ByteSource } from "../src/core/index.ts"

const GB = 1024 ** 3
const MB = 1024 ** 2

async function fileSource(path: string): Promise<ByteSource> {
  const { size } = await stat(path)
  const handle = await open(path, "r")
  return {
    size,
    async read(start, length) {
      const bytes = new Uint8Array(length)
      let done = 0
      while (done < length) {
        const { bytesRead } = await handle.read(bytes, done, length - done, start + done)
        if (bytesRead === 0) throw new Error("Unexpected end of file")
        done += bytesRead
      }
      return bytes
    },
  }
}

const timings: [string, number, number | undefined][] = []
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!

async function measure<T>(label: string, target: number | undefined, work: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const result = await work()
  timings.push([label, performance.now() - start, target])
  return result
}

function heapMb() {
  globalThis.gc?.()
  const { heapUsed, external, arrayBuffers } = process.memoryUsage()
  return Math.round((heapUsed + external + arrayBuffers) / MB)
}

const path = process.argv[2]
const source = path ? await fileSource(path) : syntheticSource({ size: 100 * GB })
const shouldIndex = Boolean(path) || process.env.INDEX === "1"
console.log(`${path ?? "synthetic"}: ${(source.size / GB).toFixed(1)} GB`)
const baseline = heapMb()

let document!: TextDocument
await measure("Open", undefined, async () => {
  document = TextDocument.open(source, { index: shouldIndex })
})
const firstRows = await measure("First screen of rows (60)", 300, () => document.snapshot().rows(0, 60))
console.log(`  first row: ${firstRows[0]!.text.slice(0, 60)}`)

if (shouldIndex) {
  const start = performance.now()
  await document.indexed
  const seconds = (performance.now() - start) / 1000
  console.log(`  indexed ${(source.size / GB).toFixed(1)} GB in ${seconds.toFixed(1)} s: ${(source.size / GB / seconds).toFixed(2)} GB/s, ${document.snapshot().lineCount.toLocaleString("en-AU")} lines, index ${(document.lineIndex.memoryBytes / MB).toFixed(1)} MB`)
}

const jumps: number[] = []
for (let round = 0; round < 200; round += 1) {
  const offset = Math.floor(((round * 2654435761) % 4294967296) / 4294967296 * (source.size - 8192))
  const start = performance.now()
  const snapshot = document.snapshot()
  const row = await snapshot.lineStartBefore(offset)
  await snapshot.rows(row, 60)
  jumps.push(performance.now() - start)
}
timings.push(["Jump to any byte and read a screen, p99", percentile(jumps, 0.99), 50])

const edits: number[] = []
for (let round = 0; round < 5000; round += 1) {
  const size = document.size
  const offset = Math.floor((((round * 2654435761) % 4294967296) / 4294967296) * size)
  const start = performance.now()
  await document.edit([{ start: offset, end: offset, text: "x" }])
  edits.push(performance.now() - start)
}
timings.push(["Edit at a random offset, p99", percentile(edits, 0.99), 16])
const typing: number[] = []
const at = Math.floor(document.size / 2)
for (let round = 0; round < 20000; round += 1) {
  const start = performance.now()
  await document.edit([{ start: at + round, end: at + round, text: "y" }], { group: "typing" })
  typing.push(performance.now() - start)
}
timings.push(["Typing burst, one edit, p99", percentile(typing, 0.99), 16])

const snapshot = document.snapshot()
if (snapshot.exactLines) {
  const lookups: number[] = []
  for (let round = 0; round < 500; round += 1) {
    const line = Math.floor(((round * 2654435761) % 4294967296) / 4294967296 * (snapshot.lineCount - 1))
    const start = performance.now()
    await snapshot.lineStart(line)
    lookups.push(performance.now() - start)
  }
  timings.push(["Line number to offset, p99", percentile(lookups, 0.99), 50])
}

await measure("Undo one step", 16, () => document.undo())
await measure("Search 256 MB in the middle", undefined, async () => {
  let count = 0
  const start = Math.floor(document.size / 2)
  for await (const _ of document.snapshot().search(/"trace":"ab|ERROR/, { start, end: Math.min(document.size, start + 256 * MB) })) count += 1
  console.log(`  ${count.toLocaleString("en-AU")} matches`)
})

console.log(`  pieces after 25,000 edits: ${document.snapshot().pieces.toLocaleString("en-AU")}`)
console.log("")
let failed = false
for (const [label, ms, target] of timings) {
  const missed = target !== undefined && ms > target
  failed ||= missed
  console.log(`${missed ? "MISS" : target === undefined ? "    " : "ok  "}  ${label.padEnd(44)} ${ms.toFixed(2).padStart(9)} ms${target === undefined ? "" : `  (target ${target})`}`)
}
console.log(`\nMemory held by the process, above baseline: ${heapMb() - baseline} MB`)
process.exitCode = failed ? 1 : 0
