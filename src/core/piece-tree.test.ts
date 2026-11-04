import { describe, expect, it } from "vitest"
import { ADDED, concat, findPiece, forEachPiece, fromPieces, join, ORIGINAL, split, toPieces, type Piece, type PieceTree } from "./piece-tree.ts"

const piece = (start: number, length: number): Piece => ({ source: ADDED, start, length, lf: 1 })

function balanced(node: PieceTree): number {
  if (!node) return 0
  const left = balanced(node.left)
  const right = balanced(node.right)
  if (Math.abs(left - right) > 1 || node.height !== Math.max(left, right) + 1) throw new Error("Unbalanced")
  return node.height
}

describe("piece tree", () => {
  it("stays balanced however pieces are added", () => {
    let root: PieceTree = null
    for (let index = 0; index < 5000; index += 1) root = join(root, piece(index, 1), null)
    balanced(root)
    expect(root!.height).toBeLessThanOrEqual(15)
    expect(root!.pieces).toBe(5000)
  })

  it("stays balanced through random splits and joins", () => {
    let root = fromPieces(Array.from({ length: 2000 }, (_, index) => piece(index * 10, 10)))
    for (let round = 0; round < 2000; round += 1) {
      const offset = (round * 7919) % (root?.bytes ?? 1)
      const [low, high] = split(root, offset, 0)
      balanced(low)
      balanced(high)
      root = concat(high, low)
      balanced(root)
    }
    expect(root!.bytes).toBe(20000)
  })

  it("does not mutate the tree it was given", () => {
    const root = fromPieces([piece(0, 10), piece(10, 10)])
    const before = toPieces(root)
    split(root, 5, 0)
    concat(root, fromPieces([piece(20, 10)]))
    expect(toPieces(root)).toEqual(before)
  })

  it("shares what an edit did not touch", () => {
    const root = fromPieces(Array.from({ length: 1024 }, (_, index) => piece(index, 1)))
    const [low] = split(root, 1, 0)
    expect(low!.pieces).toBe(1)
    const originals = new Set<PieceTree>()
    const walk = (node: PieceTree) => {
      if (!node) return
      originals.add(node)
      walk(node.left)
      walk(node.right)
    }
    walk(root)
    let fresh = 0
    const [, high] = split(root, 512, 0)
    const count = (node: PieceTree) => {
      if (!node) return
      if (!originals.has(node)) fresh += 1
      else return
      count(node.left)
      count(node.right)
    }
    count(high)
    expect(fresh).toBeLessThan(60)
  })

  it("handles offsets past 4 GB", () => {
    const big = 40 * 1024 * 1024 * 1024
    const root = fromPieces([{ source: ORIGINAL, start: 0, length: big, lf: Number.NaN }])
    const [low, high] = split(root, big - 5, Number.NaN)
    expect(low!.bytes).toBe(big - 5)
    expect(high!.bytes).toBe(5)
    expect(findPiece(concat(low, high), big - 1)?.pieceOffset).toBe(4)
    expect(low!.unknownBytes).toBe(big - 5)
  })

  it("visits only the pieces in a range", () => {
    const root = fromPieces(Array.from({ length: 100 }, (_, index) => piece(index, 1)))
    const seen: number[] = []
    forEachPiece(root, 10, 13, (_, offset) => seen.push(offset))
    expect(seen).toEqual([10, 11, 12])
  })
})
