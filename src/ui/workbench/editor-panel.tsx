import { use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Breadcrumb } from "glass-ux/breadcrumb"
import { Button } from "glass-ux/button"
import { FindBar } from "glass-ux/find-bar"
import { HoverCard } from "glass-ux/hover-card"
import { useMessages } from "glass-ux/i18n"
import { IconCaseSensitive, IconRegex, IconWholeWord } from "glass-ux/icons"
import { Notice } from "glass-ux/notice"
import { Typeahead, useTypeahead } from "glass-ux/typeahead"
import { patternOf } from "../../backend/browser-search.ts"
import type { CompletionItem, DocumentReader } from "../../backend/language.ts"
import { readerOf } from "./language.ts"
import { useEditorView } from "../../react/use-editor-view.ts"
import { workbenchMessages } from "./messages.ts"
import { uriOfPanel, type OpenRecord } from "./store.ts"
import { WorkbenchContext, type EditorRequest } from "./context.ts"

const WORD_SCAN_BYTES = 1024 * 1024
const MAX_SUGGESTIONS = 40

interface Suggestion extends CompletionItem {
  id: string
  description?: string
}

/** One file's editor, with its find bar and suggestions. */
export function EditorPanel({ id }: { id: string }) {
  const workbench = use(WorkbenchContext)!
  const uri = uriOfPanel(id)!
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const record = records.find((item) => item.uri === uri)
  return record ? <OpenEditor key={record.id} record={record} primary={id.startsWith("file:")} /> : null
}

/** A hover's text and where on the panel the text it describes is. */
interface HoverState {
  text: string
  box: { left: number; top: number; width: number; height: number }
}

/** The file's folders, then its name. The name is where a person is, so it is not a link. */
function crumbsOf(uri: string, provider: { label: string }) {
  const path = uri.replace(/^[^:]+:\/+/, "").split("/")
  return [{ id: "root", label: provider.label }, ...path.map((part, index) => ({ id: path.slice(0, index + 1).join("/"), label: decodeURIComponent(part) }))]
}

/**
 * A file's editor with its find bar, suggestions, hovers and path, for a tab or a window. A second
 * editor of the same file, from a split, is not `primary`: it shares the document and redraws when
 * the other one changes it.
 */
export function OpenEditor({ record, primary = true }: { record: OpenRecord; primary?: boolean }) {
  const workbench = use(WorkbenchContext)!
  const messages = useMessages(workbenchMessages)
  const mount = useRef<HTMLDivElement>(null)
  const { store, lexerFor, backend, findRequests } = workbench
  const { uri, opened } = record
  const { handle } = opened

  // Suggestions.
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<readonly Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const request = useRef<AbortController | null>(null)
  const wordStart = useRef(0)
  const viewRef = useRef<ReturnType<typeof useEditorView>>(null)

  const reader = useMemo<DocumentReader>(() => readerOf(uri, handle), [handle, uri])

  const openRef = useRef(false)
  const close = useCallback(() => {
    request.current?.abort()
    openRef.current = false
    setOpen(false)
    setItems([])
  }, [])

  const suggest = useCallback(async (trigger?: string) => {
    const view = viewRef.current
    if (!view) return
    const word = await view.wordBeforeCaret()
    const triggered = trigger !== undefined && (backend.completion?.triggerCharacters ?? []).includes(trigger)
    if (word.text.length === 0 && !triggered) return close()
    wordStart.current = word.start
    setQuery(word.text)
    // Taken once, where the word began, or the list would slide along as the person types.
    if (!openRef.current) setAnchor(view.caretRect())
    openRef.current = true
    setOpen(true)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(Boolean(backend.completion))
    const lower = word.text.toLowerCase()
    const state = await handle.state()
    const sample = await handle.text(0, Math.min(state.size, WORD_SCAN_BYTES))
    const words = new Set(sample.match(/[\p{L}_$][\p{L}\p{N}_$]{2,}/gu) ?? [])
    words.delete(word.text)
    const fromText: Suggestion[] = [...words].filter((text) => text.toLowerCase().startsWith(lower)).sort().slice(0, MAX_SUGGESTIONS).map((text) => ({ id: `word:${text}`, label: text, kind: "text" }))
    if (!controller.signal.aborted) setItems(fromText)
    if (!backend.completion) return
    try {
      const position = await handle.positionAt(word.start + new TextEncoder().encode(word.text).length)
      const provided = await backend.completion.provideCompletions(reader, position, trigger ? { triggerCharacter: trigger } : {}, controller.signal)
      if (controller.signal.aborted) return
      const seen = new Set(provided.map((item) => item.label))
      const filtered = provided.filter((item) => (item.filterText ?? item.label).toLowerCase().startsWith(lower))
      setItems([...filtered.map((item) => ({ ...item, id: `item:${item.label}`, description: item.detail })), ...fromText.filter((item) => !seen.has(item.label))].slice(0, MAX_SUGGESTIONS))
    } catch {
      // A superseded or failed request leaves the word suggestions in place.
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [backend.completion, close, handle, reader])

  const typeahead = useTypeahead<Suggestion>({
    open: open && items.length > 0,
    items,
    query,
    multiline: true,
    onPick(item) {
      const view = viewRef.current
      if (!view) return
      const head = view.selection[0]!.head
      view.replaceRange(wordStart.current, head, item.insertText ?? item.label)
      close()
      view.focus()
    },
    onClose: close,
  })
  const typeaheadRef = useRef(typeahead)
  typeaheadRef.current = typeahead

  const view = useEditorView(mount, handle, {
    ariaLabel: uri,
    lexer: lexerFor(uri),
    onStatus: (status) => store.patch(uri, { status }),
    onChange: (state) => {
      store.changed(uri, state)
      for (const other of store.viewsOf(uri)) if (other !== viewRef.current) void other.refresh()
    },
    onTyped: (text) => void suggest(text.slice(-1)),
    onKey(event) {
      if (!typeaheadRef.current.open) {
        if (event.key === "Backspace" || event.key === "ArrowLeft" || event.key === "ArrowRight") close()
        return false
      }
      typeaheadRef.current.onKeyDown(event)
      return event.defaultPrevented
    },
  })
  viewRef.current = view

  useEffect(() => {
    if (!view) return
    // Commands act on the editor of a file that last had focus.
    const focused = () => {
      if (store.get(uri)?.view !== view) store.patch(uri, { view })
      findRequests.focus(uri, requestRef.current)
    }
    view.root.addEventListener("focusin", focused)
    // Every editor of the file is listed, so a change in one redraws the others.
    const stopExtra = store.addView(uri, view)
    if (primary || !store.get(uri)?.view) store.patch(uri, { view })
    view.focus()
    const { selection } = store.get(uri) ?? {}
    if (selection && primary) void view.select(selection)
    return () => {
      view.root.removeEventListener("focusin", focused)
      stopExtra?.()
      // A move to or from a window mounts the next editor before this one leaves.
      if (store.get(uri)?.view === view) store.patch(uri, { view: store.viewsOf(uri).find((other) => other !== view) ?? null })
    }
  }, [findRequests, primary, store, uri, view])

  // The input stays the focused element, so it carries the list's state for assistive technology.
  useEffect(() => {
    const input = view?.input
    if (!input) return
    for (const [name, value] of Object.entries(typeahead.textProps)) {
      if (value === undefined) input.removeAttribute(name)
      else input.setAttribute(name, String(value))
    }
  }, [typeahead.textProps, view])

  // Diagnostics.
  const { diagnostics: source } = backend
  useEffect(() => {
    if (!source) return
    return source.subscribe(uri, (diagnostics) => store.patch(uri, { diagnostics }))
  }, [source, store, uri])
  useEffect(() => {
    if (!view) return
    let current = true
    void Promise.all(record.diagnostics.map(async (item) => ({ start: await handle.offsetAt(item.range.start), end: await handle.offsetAt(item.range.end), severity: item.severity, message: item.message }))).then((marks) => {
      if (current) view.setMarks(marks)
    })
    return () => {
      current = false
    }
  }, [handle, record.diagnostics, view])

  // Find.
  const [findOpen, setFindOpen] = useState(false)
  const [term, setTerm] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [count, setCount] = useState<number | undefined>(undefined)
  const [searching, setSearching] = useState(false)

  // Hovers: from the language service, for the text under the pointer or at the caret.
  const panel = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const hoverRequest = useRef<{ timer: ReturnType<typeof setTimeout> | null; abort: AbortController | null }>({ timer: null, abort: null })
  const hoverAt = useCallback(async (offset: number) => {
    const provider = backend.hover
    if (!provider || !view || !panel.current) return
    hoverRequest.current.abort?.abort()
    const abort = new AbortController()
    hoverRequest.current.abort = abort
    try {
      const found = await provider.provideHover(reader, await handle.positionAt(offset), abort.signal)
      const rect = view.rectAt(offset)
      if (abort.signal.aborted || !found || !rect) return
      const frame = panel.current.getBoundingClientRect()
      setHover({ text: found.contents, box: { left: rect.left - frame.left, top: rect.top - frame.top, width: Math.max(rect.width, 8), height: rect.height } })
    } catch {
      // A failed or superseded hover shows nothing.
    }
  }, [backend.hover, handle, reader, view])
  const endHover = useCallback(() => {
    const pending = hoverRequest.current
    if (pending.timer) clearTimeout(pending.timer)
    pending.abort?.abort()
    setHover(null)
  }, [])
  useEffect(() => {
    const element = mount.current
    if (!element || !view || !backend.hover) return
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const pending = hoverRequest.current
      if (pending.timer) clearTimeout(pending.timer)
      const { clientX, clientY } = event
      pending.timer = setTimeout(() => {
        const offset = view.offsetAtPoint(clientX, clientY)
        if (offset === null) return
        void hoverAt(offset)
      }, 450)
    }
    element.addEventListener("pointermove", onMove)
    element.addEventListener("pointerleave", endHover)
    element.addEventListener("keydown", endHover)
    element.addEventListener("wheel", endHover, { passive: true })
    return () => {
      element.removeEventListener("pointermove", onMove)
      element.removeEventListener("pointerleave", endHover)
      element.removeEventListener("keydown", endHover)
      element.removeEventListener("wheel", endHover)
    }
  }, [backend.hover, endHover, hoverAt, view])

  // Go to definition with a modifier and a click, as the keyboard does with F12.
  useEffect(() => {
    const element = mount.current
    if (!element || !backend.definition) return
    const onClick = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey) void workbench.goToDefinition(uri)
    }
    element.addEventListener("click", onClick)
    return () => element.removeEventListener("click", onClick)
  }, [backend.definition, uri, workbench])

  const requestRef = useRef<(request: EditorRequest) => void>(() => undefined)
  requestRef.current = (request) => {
    if (request === "find") setFindOpen(true)
    else if (view) void hoverAt(view.selection[0]!.head)
  }
  useEffect(() => findRequests.subscribe(uri, (request) => requestRef.current(request)), [findRequests, uri])

  const pattern = useMemo(() => {
    if (!findOpen || !term) return null
    try {
      return patternOf({ text: term, matchCase, regex, wholeWord })
    } catch {
      return null
    }
  }, [findOpen, matchCase, regex, term, wholeWord])
  const findQuery = useMemo(() => (pattern ? { source: pattern.source, flags: pattern.flags } : null), [pattern])

  useEffect(() => {
    view?.setMatches(pattern)
    setCount(findQuery ? 0 : undefined)
    if (!findQuery) return
    setSearching(true)
    return handle.countMatches(findQuery, ({ count: found, done }) => {
      setCount(found)
      if (done) setSearching(false)
    })
  }, [findQuery, handle, pattern, record.version, view])

  const step = useCallback(async (direction: 1 | -1) => {
    if (!view || !findQuery) return
    const { anchor: from, head } = view.selection[0]!
    const match = direction > 0 ? await handle.findNext(findQuery, Math.max(from, head)) : await handle.findPrevious(findQuery, Math.min(from, head))
    if (match) await view.select([{ anchor: match.start, head: match.end }])
  }, [findQuery, handle, view])

  const replaceCurrent = useCallback(async (replacement: string) => {
    if (!view || !findQuery) return
    const { anchor: from, head } = view.selection[0]!
    if (from !== head) view.replaceRange(Math.min(from, head), Math.max(from, head), replacement)
    await step(1)
  }, [findQuery, step, view])

  const replaceEvery = useCallback(async (replacement: string) => {
    if (!view || !findQuery) return
    const state = await handle.replaceAll(findQuery, replacement)
    store.changed(uri, state)
    await Promise.all(store.viewsOf(uri).map((each) => each.refresh()))
  }, [findQuery, handle, store, uri, view])

  const editable = Boolean(record.provider.write || record.provider.applyEdits)
  const crumbs = useMemo(() => crumbsOf(uri, record.provider), [record.provider, uri])

  return (
    <div ref={panel} className="gux-editor-panel">
      <Breadcrumb size="xs" aria-label={messages.path} items={crumbs} className="gux-editor-path" />
      {findOpen ? (
        <FindBar
          floating
          autoFocus
          open
          value={term}
          onValueChange={setTerm}
          matchCount={count}
          searching={searching}
          onNext={() => void step(1)}
          onPrevious={() => void step(-1)}
          onOpenChange={(next) => {
            setFindOpen(next)
            if (!next) view?.focus()
          }}
          onReplace={editable ? (value) => void replaceCurrent(value) : undefined}
          onReplaceAll={editable ? (value) => void replaceEvery(value) : undefined}
          toggles={
            <>
              <Button size="xs" variant={matchCase ? "soft" : "ghost"} icon={<IconCaseSensitive />} aria-pressed={matchCase} aria-label={messages.matchCase} tooltip={messages.matchCase} onClick={() => setMatchCase(!matchCase)} />
              <Button size="xs" variant={wholeWord ? "soft" : "ghost"} icon={<IconWholeWord />} aria-pressed={wholeWord} aria-label={messages.matchWord} tooltip={messages.matchWord} onClick={() => setWholeWord(!wholeWord)} />
              <Button size="xs" variant={regex ? "soft" : "ghost"} icon={<IconRegex />} aria-pressed={regex} aria-label={messages.useRegex} tooltip={messages.useRegex} onClick={() => setRegex(!regex)} />
            </>
          }
        />
      ) : null}
      {record.recovered ? (
        <div className="gux-editor-notice">
          <Notice
            tone={record.recovered.current ? "info" : "warning"}
            action={
              <span className="gux-editor-notice-actions">
                {record.recovered.current ? (
                  <Button size="xs" variant="secondary" onClick={async () => {
                    await store.recover(uri)
                    await Promise.all(store.viewsOf(uri).map((each) => each.refresh()))
                  }}>{messages.restore}</Button>
                ) : null}
                <Button size="xs" variant="ghost" onClick={() => store.dismissRecovery(uri)}>{messages.discard}</Button>
              </span>
            }
          >
            {record.recovered.current ? messages.recoveredEdits({ name: workbench.nameOf(uri) }) : messages.recoveredStale({ name: workbench.nameOf(uri) })}
          </Notice>
        </div>
      ) : null}
      {record.conflict ? (
        <div className="gux-editor-notice">
          <Notice
            tone="warning"
            action={
              <span className="gux-editor-notice-actions">
                <Button size="xs" variant="secondary" onClick={() => void workbench.overwrite(uri)}>{messages.overwrite}</Button>
                <Button size="xs" variant="ghost" onClick={() => void workbench.reload(uri)}>{messages.reload}</Button>
              </span>
            }
          >
            {messages.conflict({ name: workbench.nameOf(uri) })}
          </Notice>
        </div>
      ) : null}
      <div ref={mount} className="gux-editor-mount" />
      {hover ? (
        <HoverCard.Root open onOpenChange={(next) => !next && setHover(null)}>
          <HoverCard.Trigger render={<span className="gux-hover-anchor" aria-hidden="true" style={hover.box} />} />
          <HoverCard.Popup size="lg" side="top" align="start">
            <p className="gux-hover-text" dir="auto">{hover.text}</p>
          </HoverCard.Popup>
        </HoverCard.Root>
      ) : null}
      <Typeahead state={typeahead} anchor={anchor ?? mount} label={messages.suggestions} loading={loading} reserveRows={loading ? 5 : undefined} />
    </div>
  )
}
