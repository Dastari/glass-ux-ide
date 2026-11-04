import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { AlertDialog } from "glass-ux/alert-dialog"
import { AppearanceSettings } from "glass-ux/appearance-settings"
import { useCommandPalette } from "glass-ux/command-palette"
import { Dialog } from "glass-ux/dialog"
import { Button } from "glass-ux/button"
import { Field } from "glass-ux/field"
import { FileDialog, type FileSelection } from "glass-ux/file-dialog"
import { Input } from "glass-ux/input"
import type { FileProvider, FileUri } from "glass-ux/file-provider"
import { useAnnounce } from "glass-ux/hooks"
import { useMessages } from "glass-ux/i18n"
import { KeymapProvider, ShortcutHelpDialog } from "glass-ux/keymap"
import { closePanel, column, layoutOf, openPanel, panelsOf, parsePaneLayout, sized, stack, stackOf, stacksOf, type PaneLayoutState } from "glass-ux/pane-layout"
import { toast } from "glass-ux/toast"
import { registerWindowKind, useOptionalWindowManager } from "glass-ux/windows"
import { listFiles } from "../../backend/browser-search.ts"
import type { IdeBackend } from "../../backend/language.ts"
import { browserRecovery, canRecover, type RecoveryStore } from "../../backend/recovery.ts"
import { SaveConflictError } from "../../core/document.ts"
import { tierOf } from "../../core/tiers.ts"
import { formatText, languageOf } from "../../format/index.ts"
import { DocumentSyncBridge } from "./document-sync.tsx"
import { applyTextEdits, editBetween, readerOf } from "./language.ts"
import type { Lexer } from "../../core/lexer.ts"
import { codeWindowId, codeWindowInput, codeWindowKind, codeWindowUri } from "./code-window.tsx"
import { WorkbenchCommandsContext, useWorkbenchCommandList } from "./commands.ts"
import { FindRequests, OutputLog, WorkbenchContext, WorkbenchLayoutContext, type WorkbenchContextValue, type WorkbenchLayoutValue, type WorkbenchPanel } from "./context.ts"
import { replacePanel, setCollapsed, showFileTabs, showPanel as placePanel } from "./layout.ts"
import { workbenchMessages } from "./messages.ts"
import { changesPanelOf, isDirty, isDocumentPanel, panelOf, splitPanelOf, uriOfPanel, WorkbenchStore } from "./store.ts"

/** Props of {@link WorkbenchProvider}. */
export interface WorkbenchProviderProps {
  /** Where files come from and what provides language features. Only `files` is needed. */
  backend: IdeBackend & { files: readonly FileProvider[] }
  /** Highlighting by file extension, such as `{ ts: typescriptLexer }`. */
  lexers?: Readonly<Record<string, Lexer>>
  /** Files open at the start. */
  initialFiles?: readonly FileUri[]
  /** Makes a document worker. Default: the package's worker, which most bundlers can find. */
  createWorker?: () => Worker
  /** The application's own panels, beside Problems and Output. */
  panels?: readonly WorkbenchPanel[]
  /** Where the layout is remembered. Leave out to remember nothing. */
  storageKey?: string
  /**
   * Where unsaved edits are kept, so a crash or a closed tab loses nothing: they are offered back
   * when the file next opens. Default: the browser's IndexedDB. `null` keeps none.
   */
  recovery?: RecoveryStore | null
  /** The parts: `EditorArea`, the views and panels, and anything else that uses {@link useWorkbench}. */
  children: ReactNode
}

const defaultWorker = () => new Worker(new URL("../../core/document-worker.ts", import.meta.url), { type: "module" })
const nameOf = (uri: FileUri) => decodeURIComponent(uri.split("/").pop() ?? uri)
const extensionOf = (uri: FileUri) => uri.split(".").pop()?.toLowerCase() ?? ""
const folderOf = (uri: FileUri) => {
  const parent = uri.slice(0, uri.lastIndexOf("/"))
  return parent.endsWith(":/") || parent.endsWith("//") ? `${parent}/` : parent
}
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const NO_PANELS: readonly WorkbenchPanel[] = []

const startLayout = (panels: readonly WorkbenchPanel[]) =>
  layoutOf(column(sized(stack("welcome"), 3), sized(stack("problems", "output", ...panels.map((item) => item.id)), "12rem"))) // tokens:allow PaneLayout takes rem, which follows UI scale

function storedLayout(key: string | undefined) {
  if (!key || typeof localStorage === "undefined") return null
  try {
    const saved = parsePaneLayout(JSON.parse(localStorage.getItem(key) ?? "null"))
    // Documents do not survive a reload yet, so only the arrangement is restored.
    return saved && !panelsOf(saved.root).some(isDocumentPanel) ? saved : null
  } catch {
    return null
  }
}

/** The stack new files open in: the active file's, or any stack of files, or the first. */
const editorStack = (layout: PaneLayoutState, activeUri: FileUri | null) =>
  stackOf(layout.root, activeUri ? panelOf(activeUri) : "welcome") ?? stacksOf(layout.root).find((item) => item.panels.some(isDocumentPanel) || item.panels.includes("welcome")) ?? stacksOf(layout.root)[0]

type FileRequest = { mode: "open" } | { mode: "new" } | { mode: "saveAs"; uri: FileUri }

/**
 * Holds a workbench's open files, layout, commands and dialogs, and draws nothing else. Use it to
 * place the parts in an application that already has its own shell. `Workbench` is this with a
 * frame around it. It needs a `PaletteProvider` above it, and a `WindowManagerProvider` for files
 * to open in managed windows.
 */
export function WorkbenchProvider(props: WorkbenchProviderProps) {
  return (
    <KeymapProvider>
      <Model {...props} />
    </KeymapProvider>
  )
}

function Model({ backend, lexers, initialFiles, createWorker = defaultWorker, panels = NO_PANELS, storageKey, recovery, children }: WorkbenchProviderProps) {
  const messages = useMessages(workbenchMessages)
  const palette = useCommandPalette()
  const windows = useOptionalWindowManager()
  const announce = useAnnounce()
  const [store] = useState(() => new WorkbenchStore(createWorker, recovery === undefined ? (canRecover() ? browserRecovery() : null) : recovery))
  const [log] = useState(() => new OutputLog())
  const [findRequests] = useState(() => new FindRequests())
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [layout, setLayout] = useState<PaneLayoutState>(() => storedLayout(storageKey ? `${storageKey}.layout` : undefined) ?? startLayout(panels))
  const [activeUri, setActiveUri] = useState<FileUri | null>(null)
  const [help, setHelp] = useState(false)
  const [appearance, setAppearance] = useState(false)
  const [closing, setClosing] = useState<{ uri: FileUri; answer(close: boolean): void } | null>(null)
  const [dialog, setDialog] = useState<FileRequest | null>(null)
  const [projectFiles, setProjectFiles] = useState<readonly FileUri[]>([])
  const [filesVersion, setFilesVersion] = useState(0)
  const listed = useRef(false)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const activeRef = useRef(activeUri)
  activeRef.current = activeUri
  const lastTab = useRef<FileUri | null>(null)

  const providers = backend.files
  const providerOf = useCallback((uri: FileUri) => providers.find((item) => uri.startsWith(`${item.scheme}:`)), [providers])

  const update = useCallback((changed: PaneLayoutState) => {
    const next = showFileTabs(changed, isDocumentPanel)
    layoutRef.current = next
    setLayout(next)
    if (storageKey && typeof localStorage !== "undefined") {
      const arrangement = panelsOf(next.root).reduce((result, id) => (isDocumentPanel(id) ? closePanel(result, id) : result), next)
      localStorage.setItem(`${storageKey}.layout`, JSON.stringify(arrangement))
    }
  }, [storageKey])

  const activate = useCallback((uri: FileUri | null, tab = true) => {
    if (tab) lastTab.current = uri
    setActiveUri(uri)
  }, [])

  /** An editor stack must not vanish with its last file, or the next one has nowhere to go. */
  const keepHome = useCallback((leaving: string) => {
    const documents = panelsOf(layoutRef.current.root).filter(isDocumentPanel)
    if (documents.length !== 1 || documents[0] !== leaving) return
    const home = stackOf(layoutRef.current.root, leaving)
    if (home) update(placePanel(layoutRef.current, "welcome", home.id))
  }, [update])

  const open = useCallback(async (uri: FileUri, { preview = false }: { preview?: boolean } = {}) => {
    const provider = providerOf(uri)
    if (!provider) return
    const held = store.get(uri)
    if (held?.windowed) {
      windows?.open(codeWindowInput(uri))
      return
    }
    const started = performance.now()
    try {
      await store.open(provider, uri, preview)
    } catch (error) {
      toast.danger(messages.openFailed({ name: nameOf(uri), reason: reasonOf(error) }))
      return
    }
    if (!held) log.write(messages.opened({ name: nameOf(uri), ms: (performance.now() - started).toFixed(0) }))
    if (!preview) store.patch(uri, { preview: false })
    let next = layoutRef.current
    const editors = editorStack(next, activeRef.current)
    // One tab stays in preview: the next file opened that way takes its place.
    for (const record of store.getSnapshot()) {
      if (record.preview && record.uri !== uri && !isDirty(record) && preview) {
        next = closePanel(next, panelOf(record.uri))
        store.close(record.uri)
      }
    }
    next = placePanel(next, panelOf(uri), editors?.id)
    if (panelsOf(next.root).includes("welcome")) next = closePanel(next, "welcome")
    update(next)
    activate(uri)
    store.get(uri)?.view?.focus()
  }, [activate, log, messages, providerOf, store, update, windows])

  const save = useCallback(async (uri: FileUri) => {
    try {
      await store.save(uri)
      log.write(messages.wroteFile({ name: nameOf(uri) }))
      announce(messages.wroteFile({ name: nameOf(uri) }))
    } catch (error) {
      if (error instanceof SaveConflictError) store.patch(uri, { conflict: true })
      else toast.danger(messages.saveFailed({ name: nameOf(uri), reason: reasonOf(error) }))
    }
  }, [announce, log, messages, store])

  const askToClose = useCallback((uri: FileUri, panel: string = panelOf(uri)) => {
    const record = store.get(uri)
    const finish = () => {
      if (!store.get(uri)?.windowed) keepHome(panel)
      return true
    }
    // Closing one of two editors of a file leaves the file open in the other.
    const others = panelsOf(layoutRef.current.root).filter((id) => id !== panel && uriOfPanel(id) === uri)
    if (!record || !isDirty(record) || others.length) return finish()
    return new Promise<boolean>((resolve) => {
      setClosing({ uri, answer: (close) => resolve(close ? finish() : false) })
    })
  }, [keepHome, store])

  const close = useCallback(async (uri: FileUri) => {
    const record = store.get(uri)
    if (record?.windowed) {
      await windows?.close(codeWindowId(uri))
      return
    }
    if (!(await askToClose(uri))) return
    update(panelsOf(layoutRef.current.root).filter((id) => uriOfPanel(id) === uri).reduce(closePanel, layoutRef.current))
    store.close(uri)
    const left = stacksOf(layoutRef.current.root).map((item) => uriOfPanel(item.active ?? "")).find(Boolean) ?? null
    activate(left)
  }, [activate, askToClose, store, update, windows])

  const openInWindow = useCallback(async (uri: FileUri) => {
    if (!windows) return
    const provider = providerOf(uri)
    if (!provider) return
    await store.open(provider, uri, false)
    const held = store.get(uri)
    if (!held?.windowed) {
      const selection = held?.view?.selection
      store.patch(uri, { windowed: true, preview: false, selection: selection ? [...selection] : null })
      keepHome(panelOf(uri))
      update(panelsOf(layoutRef.current.root).filter((id) => uriOfPanel(id) === uri).reduce(closePanel, layoutRef.current))
    }
    windows.open(codeWindowInput(uri))
    activate(uri, false)
  }, [activate, keepHome, providerOf, store, update, windows])

  const moveToTab = useCallback((uri: FileUri) => {
    const held = store.get(uri)
    if (!held?.windowed) return
    const selection = held.view?.selection
    store.patch(uri, { windowed: false, selection: selection ? [...selection] : null })
    void windows?.close(codeWindowId(uri))
    let next = placePanel(layoutRef.current, panelOf(uri), editorStack(layoutRef.current, lastTab.current)?.id)
    if (panelsOf(next.root).includes("welcome")) next = closePanel(next, "welcome")
    update(next)
    activate(uri)
  }, [activate, store, update, windows])

  const showChanges = useCallback((uri: FileUri) => {
    update(placePanel(layoutRef.current, changesPanelOf(uri), editorStack(layoutRef.current, activeRef.current)?.id))
  }, [update])

  const reveal = useCallback<WorkbenchContextValue["reveal"]>(async (uri, { start, end }) => {
    await open(uri)
    const record = store.get(uri)
    if (!record) return
    const { handle } = record.opened
    const [from, to] = await Promise.all([handle.offsetAt(start), handle.offsetAt(end)])
    // A file opened just now has no editor until its panel mounts.
    for (let tries = 0; tries < 40 && !store.get(uri)?.view; tries += 1) await new Promise((resolve) => setTimeout(resolve, 25))
    await store.get(uri)?.view?.select([{ anchor: from, head: to }])
  }, [open, store])

  const showPanel = useCallback((id: string) => update(placePanel(layoutRef.current, id)), [update])

  const splits = useRef(0)
  const splitEditor = useCallback((uri: FileUri) => {
    const home = stacksOf(layoutRef.current.root).find((item) => item.active && uriOfPanel(item.active) === uri) ?? stackOf(layoutRef.current.root, panelOf(uri))
    if (!home || store.get(uri)?.windowed) return
    splits.current += 1
    update(openPanel(layoutRef.current, splitPanelOf(uri, splits.current), { stack: home.id, edge: "end" }))
  }, [store, update])

  /** The symbol at the caret of a file's focused editor, for a language service. */
  const atCaret = useCallback(async (uri: FileUri) => {
    const record = store.get(uri)
    const view = record?.view
    if (!record || !view) return null
    const { handle } = record.opened
    return { record, reader: readerOf(uri, handle), position: await handle.positionAt(view.selection[0]!.head) }
  }, [store])

  const goToDefinition = useCallback(async (uri: FileUri) => {
    const provider = backend.definition
    const here = await atCaret(uri)
    if (!provider || !here) return
    try {
      const [first] = await provider.provideDefinition(here.reader, here.position, new AbortController().signal)
      if (first) await reveal(first.uri, first.range)
      else toast.info(messages.noDefinition)
    } catch (error) {
      toast.danger(reasonOf(error))
    }
  }, [atCaret, backend.definition, messages, reveal])

  const [renaming, setRenaming] = useState<{ uri: FileUri; placeholder: string; position: { line: number; column: number } } | null>(null)
  const [newName, setNewName] = useState("")
  const renameSymbol = useCallback(async (uri: FileUri) => {
    const provider = backend.rename
    const here = await atCaret(uri)
    if (!provider || !here) return
    try {
      const prepared = provider.prepareRename ? await provider.prepareRename(here.reader, here.position, new AbortController().signal) : null
      if (provider.prepareRename && !prepared) return void toast.info(messages.nothingToRename)
      const word = prepared?.placeholder ?? (await here.record.view?.wordBeforeCaret())?.text ?? ""
      setNewName(word)
      setRenaming({ uri, placeholder: word, position: here.position })
    } catch (error) {
      toast.danger(reasonOf(error))
    }
  }, [atCaret, backend.rename, messages])

  const finishRename = useCallback(async () => {
    const provider = backend.rename
    const target = renaming
    setRenaming(null)
    if (!provider || !target || !newName.trim() || newName === target.placeholder) return
    const record = store.get(target.uri)
    if (!record) return
    try {
      const { changes } = await provider.provideRenameEdits(readerOf(target.uri, record.opened.handle), target.position, newName.trim(), new AbortController().signal)
      for (const [uri, edits] of Object.entries(changes)) {
        if (!store.get(uri)) await open(uri)
        await applyTextEdits(store, uri, edits, messages.renameSymbol)
      }
      // The files a rename touched opened as tabs; the one it started in stays in front.
      await open(target.uri)
    } catch (error) {
      toast.danger(reasonOf(error))
    }
  }, [backend.rename, messages, newName, open, renaming, store])

  const format = useCallback(async (uri: FileUri) => {
    const record = store.get(uri)
    if (!record) return
    const { handle } = record.opened
    try {
      if (backend.format) {
        const edits = await backend.format.format(readerOf(uri, handle), new AbortController().signal)
        return void (await applyTextEdits(store, uri, edits, messages.format))
      }
      const state = await handle.state()
      if (tierOf(state.size) > 0) return void toast.info(messages.tooLargeToFormat)
      const text = await handle.text(0, state.size)
      const formatted = formatText(text, languageOf(uri))
      if (formatted === null) return void toast.info(messages.noFormatter({ name: nameOf(uri) }))
      const edit = editBetween(text, formatted)
      if (edit) await applyTextEdits(store, uri, [edit], messages.format)
    } catch (error) {
      toast.danger(reasonOf(error))
    }
  }, [backend.format, messages, store])

  const togglePanels = useCallback(() => {
    const area = stackOf(layoutRef.current.root, "problems") ?? stackOf(layoutRef.current.root, "output")
    if (area) update(setCollapsed(layoutRef.current, area.id, !area.collapsed))
  }, [update])

  const quickOpen = useCallback(() => {
    palette.open()
    if (listed.current) return
    listed.current = true
    const signal = new AbortController().signal
    void Promise.all(providers.map((provider) => listFiles(provider, signal).catch(() => []))).then((lists) => setProjectFiles(lists.flat().map((file) => file.uri)))
  }, [palette, providers])


  const value = useMemo<WorkbenchContextValue>(() => ({
    store,
    log,
    backend,
    findRequests,
    activeUri,
    filesVersion,
    panels,
    nameOf,
    lexerFor: (uri) => lexers?.[extensionOf(uri)],
    open,
    reveal,
    save,
    close,
    confirmClose: askToClose,
    openInWindow: windows ? openInWindow : undefined,
    moveToTab,
    showChanges,
    splitEditor,
    goToDefinition,
    renameSymbol,
    format,
    showPanel,
    togglePanels,
    quickOpen,
    fileDialog: setDialog,
    showShortcuts: () => setHelp(true),
    showAppearance: () => setAppearance(true),
    async overwrite(uri) {
      try {
        await store.overwrite(uri)
        log.write(messages.wroteFile({ name: nameOf(uri) }))
      } catch (error) {
        toast.danger(messages.saveFailed({ name: nameOf(uri), reason: reasonOf(error) }))
      }
    },
    async reload(uri) {
      const provider = providerOf(uri)
      if (!provider) return
      store.close(uri)
      await store.open(provider, uri, false)
    },
  }), [activeUri, askToClose, backend, close, filesVersion, findRequests, format, goToDefinition, lexers, log, messages, moveToTab, open, openInWindow, panels, providerOf, quickOpen, renameSymbol, reveal, save, showChanges, showPanel, splitEditor, store, togglePanels, windows])

  const onLayoutChange = useCallback((next: PaneLayoutState) => {
    const before = stacksOf(layoutRef.current.root)
    const moved = stacksOf(next.root).find((item) => before.find((old) => old.id === item.id)?.active !== item.active && uriOfPanel(item.active ?? ""))
    update(next)
    const shown = new Set(panelsOf(next.root).map(uriOfPanel))
    for (const record of store.getSnapshot()) if (!shown.has(record.uri) && !record.windowed) store.close(record.uri)
    const current = activeRef.current && (shown.has(activeRef.current) || store.get(activeRef.current)?.windowed) ? activeRef.current : null
    const uri = moved ? uriOfPanel(moved.active!) : (current ?? uriOfPanel(stacksOf(next.root).find((item) => uriOfPanel(item.active ?? ""))?.active ?? ""))
    activate(uri)
    if (moved && uri) store.get(uri)?.view?.focus()
  }, [activate, store, update])

  useEffect(() => {
    for (const uri of initialFiles ?? []) void open(uri)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only the files open at the start
  }, [])

  useEffect(() => {
    // The page may not come back: keep the journals written so far.
    const leave = () => store.flush()
    addEventListener("pagehide", leave)
    return () => {
      removeEventListener("pagehide", leave)
      store.dispose()
    }
  }, [store])

  useEffect(() => {
    if (!windows) return
    registerWindowKind(codeWindowKind)
    const stopFocus = windows.on("focus", ({ entry }) => {
      const uri = entry ? codeWindowUri(entry) : null
      activate(uri ?? lastTab.current, !uri)
    })
    // The check runs in the manager, so it holds even before a window's body has loaded.
    const allowed = new Set<FileUri>()
    const stopBeforeClose = windows.on("beforeclose", (event) => {
      const uri = event.entry ? codeWindowUri(event.entry) : null
      const record = uri ? store.get(uri) : undefined
      if (!uri || !record?.windowed || !isDirty(record) || allowed.delete(uri)) return
      event.preventDefault()
      void Promise.resolve(askToClose(uri)).then((close) => {
        if (!close) return
        allowed.add(uri)
        void windows.close(codeWindowId(uri))
      })
    })
    const stopClose = windows.on("close", ({ entry }) => {
      const uri = entry ? codeWindowUri(entry) : null
      if (!uri || !store.get(uri)?.windowed) return
      store.close(uri)
      if (activeRef.current === uri) activate(lastTab.current)
    })
    return () => {
      stopFocus()
      stopBeforeClose()
      stopClose()
    }
  }, [activate, askToClose, store, windows])

  const areaValue = useMemo<WorkbenchLayoutValue>(() => ({ layout, onLayoutChange }), [layout, onLayoutChange])
  const commands = useWorkbenchCommandList(value, records, projectFiles)

  const saving = dialog?.mode === "saveAs" ? dialog.uri : null
  const finishNew = useCallback(async (provider: FileProvider, uri: FileUri) => {
    await store.open(provider, uri, false)
    await open(uri)
  }, [open, store])

  const onOpen = useCallback(async (selection: Parameters<NonNullable<Extract<Parameters<typeof FileDialog>[0], { mode: "open" }>["onOpen"]>>[0]) => {
    if (!("provider" in selection)) return
    await Promise.all((selection as FileSelection).files.map((file) => open(file.uri)))
  }, [open])

  return (
    <WorkbenchContext value={value}>
      <WorkbenchLayoutContext value={areaValue}>
        <WorkbenchCommandsContext value={commands}>
          {children}
          {backend.documents ? <DocumentSyncBridge store={store} sync={backend.documents} /> : null}
          <Dialog.Root open={renaming !== null} onOpenChange={(next) => !next && setRenaming(null)}>
            <Dialog.Popup size="sm">
              <Dialog.Header title={messages.renameSymbol} />
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void finishRename()
                }}
              >
                <Dialog.Body>
                  <Field label={messages.newName}>
                    <Input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} spellCheck={false} />
                  </Field>
                </Dialog.Body>
                <Dialog.Footer>
                  <Button variant="ghost" onClick={() => setRenaming(null)}>{messages.cancel}</Button>
                  <Button variant="primary" type="submit">{messages.renameSymbol}</Button>
                </Dialog.Footer>
              </form>
            </Dialog.Popup>
          </Dialog.Root>
          <ShortcutHelpDialog open={help} onOpenChange={setHelp} />
          <Dialog.Root open={appearance} onOpenChange={setAppearance}>
            <Dialog.Popup>
              <Dialog.Header title={messages.appearance} />
              <Dialog.Body>
                <AppearanceSettings />
              </Dialog.Body>
            </Dialog.Popup>
          </Dialog.Root>
          <FileDialog mode="open" multiple open={dialog?.mode === "open"} onOpenChange={(next) => !next && setDialog(null)} providers={providers} onOpen={onOpen} />
          <FileDialog
            mode="save"
            open={dialog?.mode === "new" || dialog?.mode === "saveAs"}
            onOpenChange={(next) => !next && setDialog(null)}
            providers={providers}
            title={saving ? undefined : messages.newFile}
            defaultUri={saving ? folderOf(saving) : undefined}
            defaultName={saving ? nameOf(saving) : messages.untitledName}
            onSave={async (target, { signal }) => {
              if (saving) {
                const record = store.get(saving)!
                const result = await record.opened.saveTo(target.provider, target.uri, target.base, signal)
                if (result.status === "written") {
                  const { version } = await record.opened.handle.state()
                  store.moved(saving, target.uri, target.provider, version)
                  update(replacePanel(layoutRef.current, panelOf(saving), panelOf(target.uri)))
                  activate(target.uri)
                  log.write(messages.wroteFile({ name: nameOf(target.uri) }))
                  setFilesVersion((version) => version + 1)
                }
                return result
              }
              const empty = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
              const result = await target.provider.write!(target.uri, empty, { base: target.base, size: 0, signal })
              if (result.status === "written") {
                await finishNew(target.provider, target.uri)
                setFilesVersion((version) => version + 1)
              }
              return result
            }}
          />
          <AlertDialog
            open={closing !== null}
            onOpenChange={(next) => {
              if (next) return
              closing?.answer(false)
              setClosing(null)
            }}
            title={closing ? messages.unsavedTitle({ name: nameOf(closing.uri) }) : ""}
            description={messages.unsavedBody}
            confirmLabel={messages.discard}
            cancelLabel={messages.cancel}
            tone="warning"
            onConfirm={() => {
              closing?.answer(true)
              setClosing(null)
            }}
          />
        </WorkbenchCommandsContext>
      </WorkbenchLayoutContext>
    </WorkbenchContext>
  )
}
