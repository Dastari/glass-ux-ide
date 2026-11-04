/** One line of a comparison, in the shape `DiffView` takes. */
export interface LineChange {
  type: "add" | "remove" | "context"
  text: string
  /** The line's number in the old text, for an unchanged or removed line. */
  before?: number
  /** The line's number in the new text, for an unchanged or added line. */
  after?: number
}

/** Past this many differing lines the comparison stops looking for the shortest edit. */
const MAX_EDIT_DISTANCE = 4000

/** The Myers path through the changed middle, as the end of each diagonal after each step. */
function trace(before: readonly string[], after: readonly string[]) {
  const limit = Math.min(before.length + after.length, MAX_EDIT_DISTANCE)
  const offset = limit + 1
  const furthest = new Int32Array(offset * 2 + 1)
  const history: Int32Array[] = []
  for (let distance = 0; distance <= limit; distance += 1) {
    history.push(furthest.slice())
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = diagonal === -distance || (diagonal !== distance && furthest[offset + diagonal - 1]! < furthest[offset + diagonal + 1]!)
      let x = down ? furthest[offset + diagonal + 1]! : furthest[offset + diagonal - 1]! + 1
      let y = x - diagonal
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1
        y += 1
      }
      furthest[offset + diagonal] = x
      if (x >= before.length && y >= after.length) return { history, offset, distance }
    }
  }
  return null
}

/** Walks the path back from the end, giving each line's fate in reverse. */
function backtrack(before: readonly string[], after: readonly string[], found: NonNullable<ReturnType<typeof trace>>) {
  const { history, offset, distance } = found
  const steps: ("add" | "remove" | "context")[] = []
  let x = before.length
  let y = after.length
  for (let step = distance; step >= 0; step -= 1) {
    const furthest = history[step]!
    const diagonal = x - y
    const down = diagonal === -step || (diagonal !== step && furthest[offset + diagonal - 1]! < furthest[offset + diagonal + 1]!)
    const previous = down ? diagonal + 1 : diagonal - 1
    const startX = furthest[offset + previous]!
    const startY = startX - previous
    while (x > startX && y > startY) {
      steps.push("context")
      x -= 1
      y -= 1
    }
    if (step > 0) {
      steps.push(down ? "add" : "remove")
      if (down) y -= 1
      else x -= 1
    }
  }
  return steps.reverse()
}

/**
 * Compares two texts line by line. Runs of unchanged lines at either end are skipped first, so a
 * small edit to a long file costs little. When the texts differ too much for the shortest edit to
 * be worth finding, the middle reads as all removed and then all added, which is still correct.
 */
export function lineDiff(beforeText: string, afterText: string): LineChange[] {
  const before = beforeText.split("\n")
  const after = afterText.split("\n")
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1

  const oldMiddle = before.slice(start, before.length - end)
  const newMiddle = after.slice(start, after.length - end)
  const found = trace(oldMiddle, newMiddle)
  const steps = found ? backtrack(oldMiddle, newMiddle, found) : [...oldMiddle.map(() => "remove" as const), ...newMiddle.map(() => "add" as const)]

  const lines: LineChange[] = []
  let oldLine = 0
  let newLine = 0
  const context = () => {
    lines.push({ type: "context", text: before[oldLine]!, before: oldLine + 1, after: newLine + 1 })
    oldLine += 1
    newLine += 1
  }
  for (let index = 0; index < start; index += 1) context()
  for (const step of steps) {
    if (step === "context") context()
    else if (step === "remove") {
      lines.push({ type: "remove", text: before[oldLine]!, before: oldLine + 1 })
      oldLine += 1
    } else {
      lines.push({ type: "add", text: after[newLine]!, after: newLine + 1 })
      newLine += 1
    }
  }
  for (let index = 0; index < end; index += 1) context()
  return lines
}

/** Keeps the changes and a few lines around each, so a long file shows only what moved. */
export function diffHunks(lines: readonly LineChange[], around = 3): LineChange[] {
  const keep = new Uint8Array(lines.length)
  lines.forEach((line, index) => {
    if (line.type === "context") return
    keep.fill(1, Math.max(0, index - around), Math.min(lines.length, index + around + 1))
  })
  return lines.filter((_, index) => keep[index])
}
