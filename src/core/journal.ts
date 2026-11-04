/**
 * A record of what happened to a document since it was opened or last saved, small enough to keep
 * on every change, from which the same text and the same undo steps can be rebuilt after a crash.
 *
 * It records operations, not text, so its size follows the edits and not the file: a keystroke in a
 * 100 GB file journals a few bytes. Replaying needs the file as it was when the journal began, so
 * each journal names that version. It cannot follow an undo back past the last save, because the
 * steps before it are not in the journal; it then says so, and holds nothing until the next save.
 */
import type { DocumentHandle, DocumentState, FindQuery } from "./handle.ts"
import type { ByteEdit } from "./types.ts"

/** One operation, as plain data that survives structured cloning. */
export type JournalOp =
  | { kind: "edit"; edits: readonly ByteEdit[]; label?: string; join: boolean }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "restore"; step: number }
  | { kind: "replaceAll"; query: FindQuery; replacement: string }

/** What a journal holds for one file. */
export interface JournalEntry {
  /** The version of the file the operations apply to, from its `stat`. */
  base: string
  ops: readonly JournalOp[]
  /** When it last changed, in epoch milliseconds. */
  at: number
}

/** Where a journal goes on each change. */
export interface JournalSink {
  /** The journal now. `null` when there is nothing to recover: no edits, or it lost track. */
  write(entry: JournalEntry | null): void
}

/** A handle that journals its changes. */
export interface JournaledHandle extends DocumentHandle {
  /** Starts again from a new base, as after a save of step `saved` (default: the current one). */
  rebase(base: string, saved?: number): Promise<void>
  /** Applies a journal recorded against the same base, then keeps journaling from there. */
  replay(entry: JournalEntry): Promise<DocumentState>
}

/**
 * Wraps a handle so every change is journaled. Steps are numbered in the journal's own terms, from
 * 0 for the text at its base, so a replay into a freshly opened document makes the same ones.
 */
export async function journaled(handle: DocumentHandle, base: string, sink: JournalSink): Promise<JournaledHandle> {
  let ops: JournalOp[] = []
  let lost = false
  let current = base
  /** The document's step ids to the journal's. */
  let steps = new Map<number, number>()
  let nextStep = 1
  steps.set((await handle.state()).version, 0)

  const publish = () => sink.write(lost || ops.length === 0 ? null : { base: current, ops: [...ops], at: Date.now() })
  const record = (op: JournalOp, state: DocumentState, before: number) => {
    if (lost) return state
    if (op.kind === "edit" || op.kind === "replaceAll") {
      if (state.version === before && op.kind === "replaceAll") return state
      if (!steps.has(state.version)) steps.set(state.version, nextStep++)
    }
    // An undo or a jump to a step from before the journal began cannot be replayed.
    if (!steps.has(state.version)) {
      lost = true
      ops = []
    } else ops.push(op)
    publish()
    return state
  }
  // Each operation goes to the document at once, in the order it was made, so nothing (a save,
  // say) can overtake it. Its record is made in the same order as the results come back.
  let last = (await handle.state()).version
  let chain: Promise<unknown> = Promise.resolve()
  const pass = <T extends DocumentState>(sent: Promise<T>, op: (state: T, before: number) => JournalOp | null) => {
    const done = chain.then(async () => {
      const state = await sent
      const before = last
      last = state.version
      const made = op(state, before)
      if (made) record(made, state, before)
      return state
    })
    chain = done.catch(() => undefined)
    return done
  }

  const wrapped: JournaledHandle = {
    ...handle,
    edit(edits, options = {}) {
      const copy = edits.map((edit) => ({ ...edit }))
      // Joined the step before: the replay must join it too, whatever the timing.
      return pass(handle.edit(edits, options), (state, before) => ({ kind: "edit", edits: copy, label: options.label, join: state.version === before }))
    },
    undo: () => pass(handle.undo(), () => ({ kind: "undo" })),
    redo: () => pass(handle.redo(), () => ({ kind: "redo" })),
    restoreStep(id) {
      const step = steps.get(id)
      return pass(handle.restoreStep(id), () => {
        if (step !== undefined) return { kind: "restore", step }
        // A step from before the journal began.
        lost = true
        ops = []
        publish()
        return null
      })
    },
    replaceAll(query, replacement) {
      return pass(handle.replaceAll(query, replacement), () => ({ kind: "replaceAll", query, replacement }))
    },
    async rebase(next, saved = last) {
      await chain
      current = next
      ops = []
      // Edits made while the file was being written are not in the journal from the new base.
      lost = saved !== last
      steps = new Map([[saved, 0]])
      nextStep = 1
      publish()
    },
    async replay(entry) {
      // The journal's step numbers, back to the document's, as the replay makes them.
      await chain
      const made = new Map<number, number>([[0, last]])
      let nextMade = 1
      let state = await handle.state()
      for (const op of entry.ops) {
        if (op.kind === "edit") {
          const before = state.version
          state = await wrapped.edit(op.edits, { label: op.label, join: op.join })
          if (state.version !== before && !op.join) made.set(nextMade++, state.version)
        } else if (op.kind === "replaceAll") {
          const before = state.version
          state = await wrapped.replaceAll(op.query, op.replacement)
          if (state.version !== before) made.set(nextMade++, state.version)
        } else if (op.kind === "undo") state = await wrapped.undo()
        else if (op.kind === "redo") state = await wrapped.redo()
        else {
          const target = made.get(op.step)
          if (target === undefined) throw new Error("The journal does not match this document.")
          state = await wrapped.restoreStep(target)
        }
      }
      return state
    },
  }
  return wrapped
}
