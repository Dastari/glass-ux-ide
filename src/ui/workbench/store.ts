/**
 * What is open, outside React: documents outlive any one component, and panels read this through
 * a store so a keystroke re-renders only what shows that file.
 */
import type { FileProvider, FileUri } from "glass-ux/file-provider"
import type { Diagnostic } from "../../backend/language.ts"
import { openFile, type OpenFile } from "../../backend/open-file.ts"
import type { RecoveryStore } from "../../backend/recovery.ts"
import { journaled, type JournaledHandle, type JournalEntry } from "../../core/journal.ts"
import type { DocumentState } from "../../core/handle.ts"
import type { EditorStatus, EditorView, Selection } from "../../view/index.ts"

export interface OpenRecord {
  /** Changes when a file is reloaded, so its editor starts afresh. */
  id: number
  uri: FileUri
  provider: FileProvider
  opened: OpenFile
  worker: Worker
  view: EditorView | null
  status: EditorStatus | null
  /** The undo step that matches the file. Undoing back to it clears the unsaved marker. */
  savedVersion: number
  version: number
  preview: boolean
  conflict: boolean
  diagnostics: readonly Diagnostic[]
  /** Shown in a managed window rather than a tab. */
  windowed: boolean
  /** The selection to restore when the editor moves between a tab and a window. */
  selection: readonly Selection[] | null
  /** Unsaved edits kept from an earlier session. `current` is false when the file has changed since. */
  recovered: { entry: JournalEntry; current: boolean } | null
  /** The document, journaling each change. */
  journal: JournaledHandle
}

export type RecordPatch = Partial<Pick<OpenRecord, "view" | "status" | "preview" | "conflict" | "diagnostics" | "windowed" | "selection" | "recovered">>

export const isDirty = (record: OpenRecord) => record.version !== record.savedVersion

/** The panel id of a file. */
export const panelOf = (uri: FileUri) => `file:${uri}`
/** The panel id of a second editor of a file, from a split. */
export const splitPanelOf = (uri: FileUri, n: number) => `view:${n}:${uri}`
/** The file a panel edits, for its main editor or a split. */
export const uriOfPanel = (id: string) => (id.startsWith("file:") ? id.slice(5) : id.startsWith("view:") ? id.slice(id.indexOf(":", 5) + 1) : null)

/** The panel id of a file's comparison with what was saved. */
export const changesPanelOf = (uri: FileUri) => `diff:${uri}`
export const uriOfChanges = (id: string) => (id.startsWith("diff:") ? id.slice(5) : null)

/** Whether a panel shows a document, so it belongs among the editors and is not remembered. */
export const isDocumentPanel = (id: string) => uriOfPanel(id) !== null || uriOfChanges(id) !== null

export class WorkbenchStore {
  private records = new Map<FileUri, OpenRecord>()
  private listeners = new Set<() => void>()
  private snapshot: readonly OpenRecord[] = []
  private readonly createWorker: () => Worker
  private opening = new Map<FileUri, Promise<OpenRecord>>()
  private nextId = 0

  private readonly recovery: RecoveryStore | null
  private writes = new Map<FileUri, { entry: JournalEntry | null; dirty: boolean; timer: ReturnType<typeof setTimeout> }>()

  constructor(createWorker: () => Worker, recovery: RecoveryStore | null = null) {
    this.createWorker = createWorker
    this.recovery = recovery
  }

  /**
   * Writes a file's journal: the first change at once, then at most twice a second while changes
   * keep coming, so typing costs little and a crash loses at most half a second.
   */
  private keep(uri: FileUri, entry: JournalEntry | null) {
    const recovery = this.recovery
    if (!recovery) return
    const held = this.writes.get(uri)
    if (held) {
      held.entry = entry
      held.dirty = true
      return
    }
    void recovery.save(uri, entry).catch(() => undefined)
    const slot = { entry, dirty: false, timer: setTimeout(() => {
      this.writes.delete(uri)
      if (slot.dirty) this.keep(uri, slot.entry)
    }, 500) }
    this.writes.set(uri, slot)
  }

  /** Writes every pending journal now, as when the page is going away. */
  flush() {
    for (const [uri, { entry, dirty, timer }] of this.writes) {
      clearTimeout(timer)
      if (dirty) void this.recovery?.save(uri, entry).catch(() => undefined)
    }
    this.writes.clear()
  }

  /** Forgets a file's journal, after a person discarded its edits. */
  forget(uri: FileUri) {
    const held = this.writes.get(uri)
    if (held) clearTimeout(held.timer)
    this.writes.delete(uri)
    void this.recovery?.save(uri, null).catch(() => undefined)
  }

  /** Applies the edits kept from an earlier session. */
  async recover(uri: FileUri) {
    const record = this.records.get(uri)
    if (!record?.recovered?.current) return
    const state = await record.journal.replay(record.recovered.entry)
    this.records.set(uri, { ...this.records.get(uri)!, recovered: null, version: state.version, preview: false })
    this.publish()
  }

  /** Leaves the edits kept from an earlier session, and forgets them. */
  dismissRecovery(uri: FileUri) {
    this.patch(uri, { recovered: null })
    this.forget(uri)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  get(uri: FileUri) {
    return this.records.get(uri)
  }

  private publish() {
    this.snapshot = [...this.records.values()]
    for (const listener of this.listeners) listener()
  }

  patch(uri: FileUri, patch: RecordPatch) {
    const record = this.records.get(uri)
    if (!record) return
    this.records.set(uri, { ...record, ...patch })
    this.publish()
  }

  private extraViews = new Map<FileUri, Set<EditorView>>()

  /** Adds an editor showing a file beside its main one, as a split does. */
  addView(uri: FileUri, view: EditorView) {
    let views = this.extraViews.get(uri)
    if (!views) this.extraViews.set(uri, (views = new Set()))
    views.add(view)
    return () => views.delete(view)
  }

  /** Every editor showing a file. */
  viewsOf(uri: FileUri): EditorView[] {
    const main = this.records.get(uri)?.view
    return [...(main ? [main] : []), ...(this.extraViews.get(uri) ?? [])].filter((view, index, all) => all.indexOf(view) === index)
  }

  /** Notes a document's history step after an edit, undo or redo. */
  changed(uri: FileUri, state: DocumentState) {
    const record = this.records.get(uri)
    if (!record || record.version === state.version) return
    this.records.set(uri, { ...record, version: state.version, preview: false })
    this.publish()
  }

  async open(provider: FileProvider, uri: FileUri, preview: boolean): Promise<OpenRecord> {
    const held = this.records.get(uri)
    if (held) return held
    const pending = this.opening.get(uri)
    if (pending) return pending
    const load = (async () => {
      const worker = this.createWorker()
      try {
        const opened = await openFile(worker, provider, uri)
        const kept = await this.recovery?.load(uri).catch(() => null)
        const journal = await journaled(opened.handle, opened.stat.version, { write: (entry) => this.keep(uri, entry) })
        // Everything reaches the document through the journal from here on.
        opened.handle = journal
        const state = await journal.state()
        const recovered = kept?.ops.length ? { entry: kept, current: kept.base === opened.stat.version } : null
        const record: OpenRecord = { id: (this.nextId += 1), uri, provider, opened, worker, journal, view: null, status: null, savedVersion: state.version, version: state.version, preview, conflict: false, diagnostics: [], windowed: false, selection: null, recovered }
        this.records.set(uri, record)
        this.publish()
        return record
      } catch (error) {
        worker.terminate()
        throw error
      } finally {
        this.opening.delete(uri)
      }
    })()
    this.opening.set(uri, load)
    return load
  }

  /** Closes a file. Its journal goes too: closing is choosing what to keep. */
  close(uri: FileUri) {
    if (this.records.has(uri)) this.forget(uri)
    this.records.get(uri)?.worker.terminate()
    this.records.delete(uri)
    this.publish()
  }

  /** Saves a file. Rejects with `SaveConflictError` when it changed somewhere else. */
  async save(uri: FileUri) {
    const record = this.records.get(uri)
    if (!record) return
    const state = await record.opened.save()
    this.markSaved(uri, state)
  }

  /** Saves over whatever is there now, after the person chose to. */
  async overwrite(uri: FileUri) {
    const record = this.records.get(uri)
    if (!record) return
    this.markSaved(uri, await record.opened.overwrite())
  }

  /** Moves an open document to the file it was just saved as. */
  moved(uri: FileUri, to: FileUri, provider: FileProvider, version: number) {
    const record = this.records.get(uri)
    if (!record) return
    this.forget(uri)
    void record.journal.rebase(record.opened.stat.version)
    this.records.delete(uri)
    this.records.set(to, { ...record, uri: to, provider, savedVersion: version, version, conflict: false, preview: false, view: null })
    this.publish()
  }

  private markSaved(uri: FileUri, state: DocumentState) {
    const record = this.records.get(uri)
    if (!record) return
    void record.journal.rebase(record.opened.stat.version)
    this.records.set(uri, { ...record, savedVersion: state.version, version: state.version, conflict: false, preview: false })
    this.publish()
  }

  dispose() {
    this.flush()
    for (const record of this.records.values()) record.worker.terminate()
    this.records.clear()
    this.publish()
  }
}
