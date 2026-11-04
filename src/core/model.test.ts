/**
 * The engine against a model that cannot be wrong: a plain byte array, edited naively. Each seed
 * is a random session, so a failure names the seed that reproduces it.
 */
import { describe, expect, it } from "vitest"
import { memorySource, TextDocument } from "./index.ts"
import type { HistoryEntry, SaveTarget } from "./index.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ["a", "bc", "hello", "\n", "\n", "\n\n", "é", "日本語", "🙂", "x".repeat(40), "  ", "\t", "line\nbreak\n"]

function randomText(next: () => number) {
  let text = ""
  const parts = Math.floor(next() * 6)
  for (let index = 0; index < parts; index += 1) text += WORDS[Math.floor(next() * WORDS.length)]
  return text
}

/** Moves a byte offset back to a character boundary, as a real caret always is. */
function boundary(bytes: Uint8Array, offset: number) {
  let at = offset
  while (at > 0 && at < bytes.length && (bytes[at]! & 0xc0) === 0x80) at -= 1
  return at
}

function splice(bytes: Uint8Array, start: number, end: number, insert: Uint8Array) {
  const result = new Uint8Array(bytes.length - (end - start) + insert.length)
  result.set(bytes.subarray(0, start))
  result.set(insert, start)
  result.set(bytes.subarray(end), start + insert.length)
  return result
}

function modelLines(bytes: Uint8Array) {
  const starts = [0]
  bytes.forEach((byte, index) => {
    if (byte === 10) starts.push(index + 1)
  })
  return starts
}

async function compare(document: TextDocument, model: Uint8Array, next: () => number, seed: number) {
  const snapshot = document.snapshot()
  expect(snapshot.size, `size, seed ${seed}`).toBe(model.length)
  expect(decoder.decode(await snapshot.read(0, model.length)), `text, seed ${seed}`).toBe(decoder.decode(model))
  for (let probe = 0; probe < 4; probe += 1) {
    const start = Math.floor(next() * (model.length + 1))
    const end = start + Math.floor(next() * (model.length - start + 1))
    expect(await snapshot.read(start, end), `range ${start}-${end}, seed ${seed}`).toEqual(model.slice(start, end))
  }
  if (!snapshot.exactLines) return
  const starts = modelLines(model)
  expect(snapshot.lineCount, `lines, seed ${seed}`).toBe(starts.length)
  for (let probe = 0; probe < 6; probe += 1) {
    const line = Math.floor(next() * starts.length)
    expect(await snapshot.lineStart(line), `lineStart ${line}, seed ${seed}`).toBe(starts[line])
    const offset = boundary(model, Math.floor(next() * (model.length + 1)))
    const expected = starts.findLastIndex((value) => value <= offset)
    expect(await snapshot.lineAt(offset), `lineAt ${offset}, seed ${seed}`).toBe(expected)
    const column = decoder.decode(model.subarray(starts[expected]!, offset)).length
    expect(await snapshot.positionAt(offset), `positionAt ${offset}, seed ${seed}`).toEqual({ line: expected, column })
    expect(await snapshot.offsetAt({ line: expected, column }), `offsetAt ${offset}, seed ${seed}`).toBe(offset)
  }
}

/** A target that either takes the whole text or patches the old bytes, as a backend might. */
function rewriteTarget(patch: boolean, base: { bytes: Uint8Array }): SaveTarget {
  return {
    async write({ size, stream, edits }) {
      let bytes = new Uint8Array(size)
      if (patch) {
        let result = base.bytes
        for (const edit of [...edits].reverse()) result = splice(result, edit.start, edit.end, edit.text as Uint8Array)
        bytes = new Uint8Array(result)
      } else {
        let at = 0
        for await (const part of stream()) {
          bytes.set(part, at)
          at += part.length
        }
      }
      base.bytes = bytes
      return memorySource(bytes)
    },
  }
}

async function session(seed: number, steps: number, indexAfter: number, saves = false) {
  const next = random(seed)
  let model: Uint8Array = encoder.encode(Array.from({ length: 40 }, () => randomText(next)).join(""))
  // Blocks and pages far smaller than real ones, so every boundary case happens constantly.
  const blockSize = 16 + Math.floor(next() * 64)
  const document = TextDocument.open(memorySource(model), { blockSize, pageSize: 32, cacheBytes: 320, index: indexAfter === 0 })
  await document.indexed
  const models = new Map<number, Uint8Array>([[document.current.id, model]])
  const base = { bytes: model }
  const steps_: HistoryEntry[] = []
  for (let step = 0; step < steps; step += 1) {
    const action = next()
    if (action < 0.15 && document.canUndo) {
      await document.undo()
      model = models.get(document.current.id)!
    } else if (action < 0.25 && document.canRedo) {
      await document.redo()
      model = models.get(document.current.id)!
    } else if (action < 0.27 && saves) {
      // Replaces the file underneath everything, so undo must survive it.
      const target = rewriteTarget(next() < 0.5, base)
      await document.save(target)
      await document.indexed
    } else if (action < 0.3 && steps_.length) {
      const entry = steps_[Math.floor(next() * steps_.length)]!
      await document.restore(entry)
      model = models.get(entry.id)!
    } else {
      const edits = []
      let working = model
      let limit = model.length
      const count = 1 + Math.floor(next() * 3)
      for (let index = 0; index < count && limit >= 0; index += 1) {
        const end = boundary(model, Math.floor(next() * (limit + 1)))
        const start = boundary(model, Math.floor(next() * (end + 1)))
        const text = randomText(next)
        edits.push({ start, end, text })
        working = splice(working, start, end, encoder.encode(text))
        limit = start - 1
      }
      const entry = await document.edit(edits)
      model = working
      models.set(entry.id, model)
      steps_.push(entry)
    }
    if (step === indexAfter && indexAfter > 0) {
      await (document as unknown as { buildIndex(options: object): Promise<void> }).buildIndex({})
    }
    await compare(document, model, next, seed)
  }
}

describe("the engine against a naive model", () => {
  it.each(Array.from({ length: 150 }, (_, index) => index + 2000))("with saves throughout, seed %i", async (seed) => {
    await session(seed, 50, 0, true)
  })

  it.each(Array.from({ length: 120 }, (_, index) => index + 1))("indexed from the start, seed %i", async (seed) => {
    await session(seed, 40, 0)
  })

  it.each(Array.from({ length: 80 }, (_, index) => index + 1000))("indexed part way through a session, seed %i", async (seed) => {
    await session(seed, 40, 12)
  })
})
