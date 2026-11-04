import { Suspense, use, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { StatusDot } from "glass-ux/badge"
import { Button } from "glass-ux/button"
import { DiffView } from "glass-ux/diff-view"
import { EmptyState } from "glass-ux/empty-state"
import { FileIcon } from "glass-ux/file-icon"
import type { FileUri } from "glass-ux/file-provider"
import { useMessages } from "glass-ux/i18n"
import { IconFile, IconFilePlus, IconFolderOpen, IconWarning } from "glass-ux/icons"
import { Kbd } from "glass-ux/kbd"
import { Skeleton } from "glass-ux/skeleton"
import { Tree, type TreeNode } from "glass-ux/tree"
import { VirtualList, type VirtualListHandle } from "glass-ux/virtual-list"
import { diffHunks, lineDiff, type LineChange } from "../../core/diff.ts"
import { tierOf } from "../../core/tiers.ts"
import { WorkbenchContext, useWorkbench } from "./context.ts"
import { workbenchMessages } from "./messages.ts"
import { isDirty, uriOfChanges } from "./store.ts"

/** What an editor stack shows when nothing is open. */
export function WelcomePanel() {
  const workbench = use(WorkbenchContext)!
  const messages = useMessages(workbenchMessages)
  const canCreate = (workbench.backend.files ?? []).some((item) => item.write)
  return (
    <div className="gux-panel-empty">
      <EmptyState
        icon={<IconFile />}
        action={
          <span className="gux-welcome-actions">
            {canCreate ? <Button size="sm" variant="secondary" icon={<IconFilePlus />} onClick={() => workbench.fileDialog({ mode: "new" })}>{messages.newFile}</Button> : null}
            <Button size="sm" variant="secondary" icon={<IconFolderOpen />} onClick={() => workbench.fileDialog({ mode: "open" })}>{messages.openFile}</Button>
            <span className="gux-welcome-hint"><Kbd keys="mod+p" /> {messages.quickOpen}</span>
          </span>
        }
      >
        {messages.noFile}
      </EmptyState>
    </div>
  )
}

/** Every open file's diagnostics, grouped by file, from whichever provider the application connected. */
export function ProblemsPanel() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const withProblems = records.filter((record) => record.diagnostics.length)
  const nodes = useMemo<TreeNode[]>(() => withProblems.map((record) => ({
    id: record.uri,
    label: workbench.nameOf(record.uri),
    icon: <FileIcon name={record.uri} />,
    selectable: false,
    children: record.diagnostics.map((item, index) => ({
      id: `${record.uri}#${index}`,
      label: item.message,
      icon: <StatusDot status={item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "online"} label={item.severity} />,
    })),
  })), [withProblems, workbench])

  if (!withProblems.length) {
    return (
      <div className="gux-panel-empty">
        <EmptyState icon={<IconWarning />}>{workbench.backend.diagnostics ? messages.noProblems : messages.noDiagnostics}</EmptyState>
      </div>
    )
  }
  const find = (id: string) => {
    const hash = id.lastIndexOf("#")
    const record = records.find((item) => item.uri === id.slice(0, hash))
    return record ? { record, diagnostic: record.diagnostics[Number(id.slice(hash + 1))] } : null
  }
  return (
    <div className="gux-panel-fill">
      <Tree
        aria-label={messages.problems}
        nodes={nodes}
        expanded={withProblems.map((record) => record.uri).filter((uri) => !collapsed.has(uri))}
        onExpandedChange={(open) => setCollapsed(new Set(withProblems.map((record) => record.uri).filter((uri) => !open.includes(uri))))}
        selectedId={null}
        // A message is in the language service's language, which need not be the page's.
        renderContent={(node, content) => (node.children ? null : (
          <span className="gux-problem">
            {node.icon}
            <span dir="auto">{content.label}</span>
          </span>
        ))}
        renderTrailing={(node) => {
          const found = node.children ? null : find(node.id)
          if (!found?.diagnostic) return null
          const { range, source } = found.diagnostic
          return <small className="gux-problem-where">{`${range.start.line + 1}:${range.start.column + 1}${source ? ` · ${source}` : ""}`}</small>
        }}
        onSelectedIdChange={(id) => {
          const found = id ? find(id) : null
          if (found?.diagnostic) void workbench.reveal(found.record.uri, found.diagnostic.range)
        }}
      />
    </div>
  )
}

/** A running record of what the workbench did. */
export function OutputPanel() {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const lines = useSyncExternalStore(workbench.log.subscribe, workbench.log.getSnapshot)
  const list = useRef<VirtualListHandle>(null)
  useEffect(() => {
    if (lines.length) list.current?.scrollToIndex(lines.length - 1)
  }, [lines])
  return (
    <div className="gux-output" role="log" aria-label={messages.output}>
      <VirtualList ref={list} items={lines} estimateSize={20} getKey={(_, index) => index} renderItem={(line) => <div className="gux-output-line">{line}</div>} />
    </div>
  )
}

/** What a read of the saved file gives: the lines to show, or that the file is too large to compare. */
type Comparison = { kind: "lines"; lines: readonly LineChange[]; same: boolean } | { kind: "large" }

function useComparison(uri: FileUri): Comparison | null {
  const workbench = useWorkbench()
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const record = records.find((item) => item.uri === uri)
  const [result, setResult] = useState<Comparison | null>(null)
  const version = record?.version
  const provider = record?.provider
  const handle = record?.opened.handle
  const stat = record?.opened.stat
  useEffect(() => {
    if (!provider || !handle || !stat) return
    const abort = new AbortController()
    void (async () => {
      const state = await handle.state()
      if (tierOf(state.size) > 0 || tierOf(stat.size ?? 0) > 0) return setResult({ kind: "large" })
      const saved = stat.size ? await provider.read(uri, { offset: 0, length: stat.size }, { signal: abort.signal }) : new Uint8Array()
      const current = await handle.text(0, state.size)
      if (abort.signal.aborted) return
      const lines = lineDiff(new TextDecoder().decode(saved), current)
      setResult({ kind: "lines", lines: diffHunks(lines), same: lines.every((line) => line.type === "context") })
    })().catch(() => undefined)
    return () => abort.abort()
  }, [handle, provider, stat, uri, version])
  return result
}

/** A file against what was last saved. It updates as the file changes. */
export function ChangesPanel({ id }: { id: string }) {
  const uri = uriOfChanges(id)!
  const messages = useMessages(workbenchMessages)
  const comparison = useComparison(uri)
  if (!comparison) return <div className="gux-panel-loading"><Skeleton.Text lines={6} /></div>
  if (comparison.kind === "large") return <div className="gux-panel-empty"><EmptyState icon={<IconFile />}>{messages.tooLargeToCompare}</EmptyState></div>
  if (comparison.same) return <div className="gux-panel-empty"><EmptyState icon={<IconFile />}>{messages.noChanges}</EmptyState></div>
  return (
    <div className="gux-changes">
      <Suspense>
        <DiffView lines={comparison.lines} label={messages.changesTo({ name: decodeURIComponent(uri.split("/").pop() ?? uri) })} />
      </Suspense>
    </div>
  )
}

/** Whether any open file has unsaved edits, for a badge. */
export function useUnsavedCount() {
  const workbench = useWorkbench()
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  return records.filter(isDirty).length
}

