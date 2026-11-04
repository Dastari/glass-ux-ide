/**
 * The document's shape: an immutable balanced tree of pieces.
 *
 * A piece is a run of bytes in the original file or the add buffer. Every operation returns a new
 * root and shares everything it did not touch, so a snapshot is one pointer and undo is swapping
 * one back. The tree is an AVL tree built on `join`, which gives split and concatenation directly;
 * an edit is two splits and a join. Costs grow with the number of edits, never the file size.
 *
 * Offsets are doubles. Nothing here may use bit operations on an offset: they truncate to 32 bits,
 * and a file past 4 GB would then fail silently.
 */

/** Where a piece's bytes live. */
export type PieceSource = 0 | 1
/** The original file. */
export const ORIGINAL: PieceSource = 0
/** The append-only add buffer. */
export const ADDED: PieceSource = 1

/** A run of bytes. `lf` is its line feed count, or NaN until the line index knows it. */
export interface Piece {
  readonly source: PieceSource
  readonly start: number
  readonly length: number
  readonly lf: number
}

/** A tree node. The aggregates cover the whole subtree. */
export interface PieceNode {
  readonly left: PieceNode | null
  readonly right: PieceNode | null
  readonly piece: Piece
  readonly height: number
  readonly bytes: number
  /** Line feeds in pieces whose count is known. */
  readonly lf: number
  /** Bytes in pieces whose line feed count is not known yet. */
  readonly unknownBytes: number
  readonly pieces: number
}

export type PieceTree = PieceNode | null

const height = (node: PieceTree) => node?.height ?? 0

function make(left: PieceTree, piece: Piece, right: PieceTree): PieceNode {
  const known = !Number.isNaN(piece.lf)
  return {
    left,
    right,
    piece,
    height: Math.max(height(left), height(right)) + 1,
    bytes: (left?.bytes ?? 0) + piece.length + (right?.bytes ?? 0),
    lf: (left?.lf ?? 0) + (known ? piece.lf : 0) + (right?.lf ?? 0),
    unknownBytes: (left?.unknownBytes ?? 0) + (known ? 0 : piece.length) + (right?.unknownBytes ?? 0),
    pieces: (left?.pieces ?? 0) + 1 + (right?.pieces ?? 0),
  }
}

function rotateLeft(node: PieceNode): PieceNode {
  const right = node.right!
  return make(make(node.left, node.piece, right.left), right.piece, right.right)
}

function rotateRight(node: PieceNode): PieceNode {
  const left = node.left!
  return make(left.left, left.piece, make(left.right, node.piece, node.right))
}

function joinRight(left: PieceNode, piece: Piece, right: PieceTree): PieceNode {
  if (height(left.right) <= height(right) + 1) {
    const middle = make(left.right, piece, right)
    if (middle.height <= height(left.left) + 1) return make(left.left, left.piece, middle)
    return rotateLeft(make(left.left, left.piece, rotateRight(middle)))
  }
  const joined = joinRight(left.right!, piece, right)
  const next = make(left.left, left.piece, joined)
  return joined.height <= height(left.left) + 1 ? next : rotateLeft(next)
}

function joinLeft(left: PieceTree, piece: Piece, right: PieceNode): PieceNode {
  if (height(right.left) <= height(left) + 1) {
    const middle = make(left, piece, right.left)
    if (middle.height <= height(right.right) + 1) return make(middle, right.piece, right.right)
    return rotateRight(make(rotateLeft(middle), right.piece, right.right))
  }
  const joined = joinLeft(left, piece, right.left!)
  const next = make(joined, right.piece, right.right)
  return joined.height <= height(right.right) + 1 ? next : rotateRight(next)
}

/** Joins two trees around one piece, keeping the balance. Every other operation is built on this. */
export function join(left: PieceTree, piece: Piece, right: PieceTree): PieceNode {
  if (height(left) > height(right) + 1) return joinRight(left!, piece, right)
  if (height(right) > height(left) + 1) return joinLeft(left, piece, right!)
  return make(left, piece, right)
}

function popFirst(node: PieceNode): [Piece, PieceTree] {
  if (!node.left) return [node.piece, node.right]
  const [first, rest] = popFirst(node.left)
  return [first, join(rest, node.piece, node.right)]
}

function popLast(node: PieceNode): [PieceTree, Piece] {
  if (!node.right) return [node.left, node.piece]
  const [rest, last] = popLast(node.right)
  return [join(node.left, node.piece, rest), last]
}

/** Removes the last piece of a tree. */
export function removeLast(root: PieceNode): [PieceTree, Piece] {
  return popLast(root)
}

/** The last piece of a tree. */
export function lastPiece(root: PieceTree): Piece | null {
  let node = root
  while (node?.right) node = node.right
  return node?.piece ?? null
}

/** Concatenates two trees. */
export function concat(left: PieceTree, right: PieceTree): PieceTree {
  if (!left) return right
  if (!right) return left
  const [first, rest] = popFirst(right)
  return join(left, first, rest)
}

/** Divides a piece `at` bytes in. `lfBefore` is the line feed count of the first part. */
function dividePiece(piece: Piece, at: number, lfBefore: number): [Piece, Piece] {
  return [
    { source: piece.source, start: piece.start, length: at, lf: lfBefore },
    { source: piece.source, start: piece.start + at, length: piece.length - at, lf: piece.lf - lfBefore },
  ]
}

/** The piece holding `offset`, and how far into it the offset falls. Null at the very end. */
export function findPiece(root: PieceTree, offset: number): { piece: Piece; pieceOffset: number; before: number; lfBefore: number } | null {
  let node = root
  let before = 0
  let lfBefore = 0
  while (node) {
    const leftBytes = node.left?.bytes ?? 0
    if (offset < before + leftBytes) {
      node = node.left
      continue
    }
    const pieceStart = before + leftBytes
    const pieceEnd = pieceStart + node.piece.length
    if (offset < pieceEnd) return { piece: node.piece, pieceOffset: offset - pieceStart, before: pieceStart, lfBefore: lfBefore + (node.left?.lf ?? 0) }
    before = pieceEnd
    lfBefore += (node.left?.lf ?? 0) + (Number.isNaN(node.piece.lf) ? 0 : node.piece.lf)
    node = node.right
  }
  return null
}

/**
 * Splits at a byte offset. A piece the offset falls inside is divided; `lfBefore` is the line feed
 * count of its first part, which the caller works out first because that can mean reading bytes.
 */
export function split(root: PieceTree, offset: number, lfBefore: number): [PieceTree, PieceTree] {
  if (!root) return [null, null]
  const leftBytes = root.left?.bytes ?? 0
  if (offset <= leftBytes) {
    if (offset === leftBytes) return [root.left, join(null, root.piece, root.right)]
    const [low, high] = split(root.left, offset, lfBefore)
    return [low, join(high, root.piece, root.right)]
  }
  const pieceEnd = leftBytes + root.piece.length
  if (offset >= pieceEnd) {
    const [low, high] = split(root.right, offset - pieceEnd, lfBefore)
    return [join(root.left, root.piece, low), high]
  }
  const [first, second] = dividePiece(root.piece, offset - leftBytes, lfBefore)
  return [join(root.left, first, null), join(null, second, root.right)]
}

/** Visits every piece overlapping a byte range, in order, with its document offset. */
export function forEachPiece(root: PieceTree, start: number, end: number, visit: (piece: Piece, offset: number) => void): void {
  const walk = (node: PieceTree, base: number) => {
    if (!node || start >= base + node.bytes || end <= base) return
    const leftBytes = node.left?.bytes ?? 0
    walk(node.left, base)
    const pieceStart = base + leftBytes
    if (start < pieceStart + node.piece.length && end > pieceStart) visit(node.piece, pieceStart)
    walk(node.right, pieceStart + node.piece.length)
  }
  walk(root, 0)
}

/** The piece holding line feed number `lf` (zero-based), and the count before that piece. */
export function findLineFeed(root: PieceTree, lf: number): { piece: Piece; before: number; lfBefore: number } | null {
  let node = root
  let before = 0
  let lfBefore = 0
  while (node) {
    const leftLf = node.left?.lf ?? 0
    if (lf < lfBefore + leftLf) {
      node = node.left
      continue
    }
    const pieceLf = Number.isNaN(node.piece.lf) ? 0 : node.piece.lf
    const start = before + (node.left?.bytes ?? 0)
    if (lf < lfBefore + leftLf + pieceLf) return { piece: node.piece, before: start, lfBefore: lfBefore + leftLf }
    before = start + node.piece.length
    lfBefore += leftLf + pieceLf
    node = node.right
  }
  return null
}

/** Rebuilds a tree from pieces in order, perfectly balanced. */
export function fromPieces(pieces: readonly Piece[]): PieceTree {
  const build = (low: number, high: number): PieceTree => {
    if (low >= high) return null
    const middle = low + Math.floor((high - low) / 2)
    return make(build(low, middle), pieces[middle]!, build(middle + 1, high))
  }
  return build(0, pieces.length)
}

/**
 * Replaces pieces whose line feed count is unknown, keeping the tree's shape. `memo` holds nodes
 * already rebuilt, because history roots share most of their structure and must keep sharing it.
 */
export function resolveLineFeeds(root: PieceTree, lookup: (piece: Piece) => number, memo: WeakMap<PieceNode, PieceNode>): PieceTree {
  if (!root || root.unknownBytes === 0) return root
  const seen = memo.get(root)
  if (seen) return seen
  const piece = Number.isNaN(root.piece.lf) ? { ...root.piece, lf: lookup(root.piece) } : root.piece
  const next = make(resolveLineFeeds(root.left, lookup, memo), piece, resolveLineFeeds(root.right, lookup, memo))
  memo.set(root, next)
  return next
}

/**
 * Replaces each piece with zero or more pieces, keeping shared subtrees shared. `memo` must be
 * used for every root that shares structure, or a long history would be copied whole.
 */
export function mapPieces(root: PieceTree, replace: (piece: Piece) => readonly Piece[], memo: WeakMap<PieceNode, PieceTree>): PieceTree {
  if (!root) return null
  const seen = memo.get(root)
  if (seen !== undefined) return seen
  const left = mapPieces(root.left, replace, memo)
  const right = mapPieces(root.right, replace, memo)
  const next = concat(concat(left, fromPieces(replace(root.piece))), right)
  memo.set(root, next)
  return next
}

/** Every piece in order. */
export function toPieces(root: PieceTree): Piece[] {
  const pieces: Piece[] = []
  const walk = (node: PieceTree) => {
    if (!node) return
    walk(node.left)
    pieces.push(node.piece)
    walk(node.right)
  }
  walk(root)
  return pieces
}
