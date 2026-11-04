/** How much background work a document gets. Editing, undo, search and saving work at every tier. */
export type Tier = 0 | 1 | 2 | 3

const MB = 1024 * 1024
const GB = 1024 * MB

/** The tier for a size in bytes. */
export function tierOf(size: number): Tier {
  if (size < 5 * MB) return 0
  if (size < 64 * MB) return 1
  if (size < 2 * GB) return 2
  return 3
}
