import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { ActivityFeed, type ActivityItem } from "glass-ux/activity-feed"
import { FileIcon } from "glass-ux/file-icon"
import type { FileUri } from "glass-ux/file-provider"
import { useDebouncedValue } from "glass-ux/hooks"
import { useMessages } from "glass-ux/i18n"
import { IconCaseSensitive, IconCollapseAll, IconFilePlus, IconGitBranch, IconHistory, IconRefresh, IconRegex, IconSearch, IconWholeWord } from "glass-ux/icons"
import { Button } from "glass-ux/button"
import { EmptyState } from "glass-ux/empty-state"
import { useLocale } from "glass-ux/locale"
import { SectionDrawer, useDrawerDismiss } from "glass-ux/shell"
import { Spinner } from "glass-ux/spinner"
import { Toolbar } from "glass-ux/toolbar"
import { Tree, type TreeNode } from "glass-ux/tree"
import { browserSearch } from "../../backend/browser-search.ts"
import type { SearchResult } from "../../backend/language.ts"
import type { HistoryStep } from "../../core/handle.ts"
import { useWorkbench } from "./context.ts"
import { FileExplorer, type FileExplorerHandle } from "./file-explorer.tsx"
import { workbenchMessages } from "./messages.ts"
import { isDirty } from "./store.ts"

const MAX_MATCHES = 2000

/** The files open now, each with its unsaved marker. */
function OpenEditors({ onChoose }: { onChoose(): void }) {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  if (!records.length) return null
  return (
    <SectionDrawer.Group id="ide.open-editors" title={messages.openEditors} count={records.length}>
      <SectionDrawer.List>
        {records.map((record) => (
          <SectionDrawer.Item
            key={record.uri}
            icon={<FileIcon name={record.uri} />}
            label={workbench.nameOf(record.uri)}
            detail={isDirty(record) ? messages.unsaved : undefined}
            active={record.uri === workbench.activeUri}
            onClick={() => {
              void workbench.open(record.uri)
              onChoose()
            }}
          />
        ))}
      </SectionDrawer.List>
    </SectionDrawer.Group>
  )
}

/** The Explorer: open files, then the project's folders, with a filter that stays put. */
export function ExplorerView() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const dismiss = useDrawerDismiss()
  const [query, setQuery] = useState("")
  const explorer = useRef<FileExplorerHandle>(null)
  const canCreate = (workbench.backend.files ?? []).some((item) => item.write)
  return (
    <SectionDrawer.Root aria-label={messages.explorer}>
      <SectionDrawer.Header
        title={messages.explorer}
        actions={
          <Toolbar aria-label={messages.explorer} overflow={false}>
            {canCreate ? <Toolbar.Button label={messages.newFile} icon={<IconFilePlus />} onClick={() => workbench.fileDialog({ mode: "new" })} /> : null}
            <Toolbar.Button label={messages.refresh} icon={<IconRefresh />} onClick={() => explorer.current?.refresh()} />
            <Toolbar.Button label={messages.collapseFolders} icon={<IconCollapseAll />} onClick={() => explorer.current?.collapseAll()} />
          </Toolbar>
        }
      />
      <SectionDrawer.Search value={query} onValueChange={setQuery} noun={messages.filesNoun} placeholder={messages.filterFiles} />
      <SectionDrawer.Body fill>
        <OpenEditors onChoose={dismiss} />
        <FileExplorer
          ref={explorer}
          providers={workbench.backend.files ?? []}
          query={query}
          selected={workbench.activeUri}
          onOpenInWindow={workbench.openInWindow ? (uri) => void workbench.openInWindow?.(uri) : undefined}
          onOpen={(uri, options) => {
            void workbench.open(uri, options)
            dismiss()
          }}
        />
      </SectionDrawer.Body>
    </SectionDrawer.Root>
  )
}

/** Search across files: `backend.search` when the application has one, otherwise in the page. */
export function SearchView() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const locale = useLocale()
  const dismiss = useDrawerDismiss()
  const [text, setText] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<readonly SearchResult[]>([])
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<FileUri>>(new Set())
  const term = useDebouncedValue(text.trim(), 200)
  const { backend } = workbench
  const search = useMemo(() => backend.search ?? browserSearch(backend.files ?? []), [backend.files, backend.search])

  useEffect(() => {
    setResults([])
    setFailure(null)
    setCollapsed(new Set())
    if (!term) {
      setRunning(false)
      return
    }
    const abort = new AbortController()
    let found = 0
    setRunning(true)
    search
      .search({ text: term, matchCase, wholeWord, regex }, (result) => {
        if (found >= MAX_MATCHES) return abort.abort()
        found += result.matches.length
        setResults((current) => [...current, result])
      }, abort.signal)
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setFailure(error instanceof SyntaxError ? messages.badPattern : String(error))
      })
      .finally(() => {
        if (!abort.signal.aborted || found >= MAX_MATCHES) setRunning(false)
      })
    return () => abort.abort()
  }, [matchCase, messages, regex, search, term, wholeWord])

  const nodes = useMemo<TreeNode[]>(() => results.map(({ uri, matches }) => ({
    id: uri,
    label: workbench.nameOf(uri),
    icon: <FileIcon name={uri} />,
    selectable: false,
    children: matches.map((match, index) => ({ id: `${uri}#${index}`, label: match.text.trim(), icon: <span /> })),
  })), [results, workbench])

  const total = results.reduce((sum, result) => sum + result.matches.length, 0)
  return (
    <SectionDrawer.Root aria-label={messages.search}>
      <SectionDrawer.Header
        title={messages.search}
        actions={
          <Toolbar aria-label={messages.search} overflow={false}>
            <Toolbar.Button label={messages.matchCase} icon={<IconCaseSensitive />} pressed={matchCase} onPressedChange={setMatchCase} />
            <Toolbar.Button label={messages.matchWord} icon={<IconWholeWord />} pressed={wholeWord} onPressedChange={setWholeWord} />
            <Toolbar.Button label={messages.useRegex} icon={<IconRegex />} pressed={regex} onPressedChange={setRegex} />
          </Toolbar>
        }
      />
      <SectionDrawer.Search value={text} onValueChange={setText} noun={messages.filesNoun} placeholder={messages.searchInFiles} />
      <SectionDrawer.Body fill>
        <p className="gux-search-summary" role="status">
          {running ? <Spinner /> : null}
          <span>{failure ?? (term ? messages.searchResults({ count: total, files: results.length, locale }) : "")}</span>
        </p>
        {nodes.length ? (
          <Tree
            aria-label={messages.search}
            nodes={nodes}
            expanded={results.map((item) => item.uri).filter((uri) => !collapsed.has(uri))}
            onExpandedChange={(open) => setCollapsed(new Set(results.map((item) => item.uri).filter((uri) => !open.includes(uri))))}
            selectedId={null}
            renderContent={(node) => (node.children ? null : <span className="gux-search-line" dir="ltr"><SectionDrawer.Match text={node.label} query={regex ? "" : term} /></span>)}
            onSelectedIdChange={(id) => {
              if (!id) return
              const hash = id.lastIndexOf("#")
              const uri = id.slice(0, hash)
              const match = results.find((item) => item.uri === uri)?.matches[Number(id.slice(hash + 1))]
              if (!match) return
              void workbench.reveal(uri, { start: { line: match.line, column: match.column }, end: { line: match.line, column: match.column + match.length } })
              dismiss()
            }}
          />
        ) : !term ? (
          <EmptyState icon={<IconSearch />}>{messages.searchInFiles}</EmptyState>
        ) : null}
      </SectionDrawer.Body>
    </SectionDrawer.Root>
  )
}

/** Files with unsaved edits, each opening its comparison with what was saved. */
export function ChangesView() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const dismiss = useDrawerDismiss()
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const changed = records.filter(isDirty)
  return (
    <SectionDrawer.Root aria-label={messages.changes}>
      <SectionDrawer.Header title={messages.changes} />
      <SectionDrawer.Body fill={!changed.length}>
        {changed.length ? (
          <SectionDrawer.List>
            {changed.map((record) => (
              <SectionDrawer.Item
                key={record.uri}
                icon={<FileIcon name={record.uri} />}
                label={workbench.nameOf(record.uri)}
                onClick={() => {
                  workbench.showChanges(record.uri)
                  dismiss()
                }}
              />
            ))}
          </SectionDrawer.List>
        ) : (
          <EmptyState icon={<IconGitBranch />}>{messages.noChanges}</EmptyState>
        )}
      </SectionDrawer.Body>
      {changed.length ? (
        <SectionDrawer.Footer>
          <Button size="sm" variant="secondary" onClick={() => void Promise.all(changed.map((record) => workbench.save(record.uri)))}>{messages.saveAll}</Button>
        </SectionDrawer.Footer>
      ) : null}
    </SectionDrawer.Root>
  )
}

/** Orders an undo tree as a timeline: the line through the current step, with other branches under the step they left. */
export function timelineOf(steps: readonly HistoryStep[]) {
  const children = new Map<number | null, HistoryStep[]>()
  for (const step of steps) children.set(step.parent, [...(children.get(step.parent) ?? []), step])
  const current = steps.find((step) => step.current)
  const leadsToCurrent = new Set<number>()
  for (let at = current; at; at = steps.find((step) => step.id === at!.parent)) leadsToCurrent.add(at.id)
  const line: { step: HistoryStep; branches: HistoryStep[] }[] = []
  let at = children.get(null)?.[0]
  while (at) {
    const next: HistoryStep[] = children.get(at.id) ?? []
    const main = next.find((step) => leadsToCurrent.has(step.id)) ?? next.at(-1)
    const branches: HistoryStep[] = []
    const collect = (step: HistoryStep) => {
      branches.push(step)
      for (const child of children.get(step.id) ?? []) collect(child)
    }
    for (const step of next) if (step !== main) collect(step)
    line.push({ step: at, branches })
    at = main
  }
  return line.reverse()
}

/** The active file's undo history as a timeline, with its branches. Choosing a step goes back, or forward, to it. */
export function TimelineView() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const record = workbench.activeUri ? records.find((item) => item.uri === workbench.activeUri) : undefined
  const [steps, setSteps] = useState<readonly HistoryStep[]>([])
  const handle = record?.opened.handle
  const version = record?.version
  useEffect(() => {
    if (!handle) return setSteps([])
    let current = true
    void handle.history().then((next) => current && setSteps(next)).catch(() => undefined)
    return () => {
      current = false
    }
  }, [handle, version])

  const saved = record?.savedVersion
  const items = useMemo<ActivityItem[]>(() => {
    const labelOf = (step: HistoryStep) => step.label ?? (step.group === "typing" ? messages.timelineTyping : step.group === "delete" ? messages.timelineDeleting : messages.timelineEdit)
    const itemOf = (step: HistoryStep, root: boolean): Omit<ActivityItem, "children"> => ({
      id: String(step.id),
      at: step.at,
      tone: step.current ? "accent" : step.id === saved ? "success" : undefined,
      toneLabel: step.current ? messages.timelineCurrent : step.id === saved ? messages.timelineSaved : undefined,
      content: [root ? messages.timelineOpened : labelOf(step), step.id === saved && !root ? messages.timelineSaved : null].filter(Boolean).join(" · "),
    })
    return timelineOf(steps).map(({ step, branches }) => ({
      ...itemOf(step, step.parent === null),
      children: branches.reverse().map((branch) => ({ ...itemOf(branch, false), content: `${messages.timelineBranch}: ${labelOf(branch)}` })),
    }))
  }, [messages, saved, steps])

  return (
    <SectionDrawer.Root aria-label={messages.timeline}>
      <SectionDrawer.Header title={messages.timeline} />
      <SectionDrawer.Body fill={!record}>
        {record ? (
          <ActivityFeed
            className="gux-timeline"
            aria-label={messages.timeline}
            items={items}
            selectedId={String(steps.find((step) => step.current)?.id ?? "")}
            onSelectedIdChange={async (id) => {
              if (id === null || !handle) return
              const state = await handle.restoreStep(Number(id))
              workbench.store.changed(record.uri, state)
              await Promise.all(workbench.store.viewsOf(record.uri).map((view) => view.refresh()))
            }}
          />
        ) : (
          <EmptyState icon={<IconHistory />}>{messages.timelineEmpty}</EmptyState>
        )}
      </SectionDrawer.Body>
    </SectionDrawer.Root>
  )
}
