import { use, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type ReactElement, type Ref } from "react"
import { ActionContextMenu, defineActions } from "glass-ux/actions"
import { AlertDialog } from "glass-ux/alert-dialog"
import { FileIcon } from "glass-ux/file-icon"
import type { FileEntry, FileProvider, FileUri } from "glass-ux/file-provider"
import { useClipboard } from "glass-ux/hooks"
import { useMessages } from "glass-ux/i18n"
import { IconCopy, IconExternalLink, IconFile, IconTrash } from "glass-ux/icons"
import { Tree, type TreeHandle, type TreeNode } from "glass-ux/tree"
import { workbenchMessages } from "./messages.ts"
import { WorkbenchContext } from "./context.ts"
import "./workbench.css"

/** What `ref` gives on {@link FileExplorer}. */
export interface FileExplorerHandle {
  /** Opens the folders down to a file and scrolls to it. */
  reveal(uri: FileUri): void
  /** Lists every open folder again. */
  refresh(): void
  /** Closes every folder. */
  collapseAll(): void
}

/** Props of {@link FileExplorer}. */
export interface FileExplorerProps {
  /** Where files come from. With more than one, each is a top-level folder. */
  providers: readonly FileProvider[]
  /** Filters rows by name. */
  query?: string
  /** The file shown as selected. */
  selected?: FileUri | null
  /** Called when a person opens a file. `preview` is a single click, which a later open may replace. */
  onOpen: (uri: FileUri, options: { preview: boolean }) => void
  /** Adds Open in new window to each file's menu. */
  onOpenInWindow?: (uri: FileUri) => void
  ref?: Ref<FileExplorerHandle>
}

const rootOf = (provider: FileProvider) => provider.root ?? `${provider.scheme}:///`
const nodeOf = (entry: FileEntry): TreeNode =>
  entry.kind === "directory"
    ? { id: entry.uri, label: entry.name, hasChildren: true }
    : { id: entry.uri, label: entry.name, icon: <FileIcon name={entry.name} />, hasChildren: false }

function replaceChildren(nodes: readonly TreeNode[], id: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => (node.id === id ? { ...node, children } : node.children ? { ...node, children: replaceChildren(node.children, id, children) } : node))
}

/**
 * A file tree over any `FileProvider`. Folders load when opened and rows offer only what the
 * provider can do: without `rename` there is no rename, so a read-only source simply reads.
 */
export function FileExplorer({ providers, query, selected, onOpen, onOpenInWindow, ref }: FileExplorerProps) {
  const messages = useMessages(workbenchMessages)
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null)
  const tree = useRef<TreeHandle>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const workbench = use(WorkbenchContext)
  const clipboard = useClipboard()

  const providerOf = useCallback((uri: FileUri) => providers.find((item) => uri.startsWith(`${item.scheme}:`)), [providers])

  const list = useCallback(async (uri: FileUri) => {
    const provider = providerOf(uri)
    if (!provider?.readDirectory) return []
    const signal = new AbortController().signal
    const entries: FileEntry[] = []
    for (let cursor: string | null | undefined; ; ) {
      const page = await provider.readDirectory(uri, { signal, cursor })
      entries.push(...page.entries)
      cursor = page.cursor
      if (!cursor) break
    }
    return entries.map(nodeOf)
  }, [providerOf])

  const single = providers.length === 1
  const refresh = useCallback(async (folder: FileUri) => {
    const children = await list(folder)
    setNodes((current) => (single && folder === rootOf(providers[0]!) ? children : replaceChildren(current, folder, children)))
  }, [list, providers, single])

  // Effects run again when a hidden view returns, and loaded folders must survive that.
  const started = useRef<readonly FileProvider[] | null>(null)
  useEffect(() => {
    if (started.current === providers) return
    started.current = providers
    if (single) void refresh(rootOf(providers[0]!))
    else {
      setNodes(providers.map((provider) => ({ id: rootOf(provider), label: provider.label, hasChildren: true })))
      setExpanded(providers.map(rootOf))
    }
  }, [providers, refresh, single])

  useImperativeHandle(ref, () => ({
    reveal: (uri) => void tree.current?.reveal(uri),
    collapseAll: () => setExpanded(single ? [] : providers.map(rootOf)),
    refresh() {
      if (single) void refresh(rootOf(providers[0]!))
      for (const folder of expandedRef.current) void refresh(folder)
    },
  }), [providers, refresh, single])

  // A file the workbench just wrote belongs in the tree without asking.
  const filesVersion = workbench?.filesVersion ?? 0
  const seenVersion = useRef(filesVersion)
  useEffect(() => {
    if (seenVersion.current === filesVersion) return
    seenVersion.current = filesVersion
    if (single) void refresh(rootOf(providers[0]!))
    for (const folder of expandedRef.current) void refresh(folder)
  }, [filesVersion, providers, refresh, single])

  const onLoadChildren = useCallback(async (node: TreeNode) => {
    const children = await list(node.id)
    setNodes((current) => replaceChildren(current, node.id, children))
  }, [list])

  const parentOf = (uri: FileUri) => {
    const parent = uri.slice(0, uri.lastIndexOf("/"))
    return parent.endsWith(":/") || parent.endsWith("//") ? `${parent}/` : parent
  }

  const actions = useMemo(
    () =>
      defineActions<TreeNode>("file", [
        { id: "open", label: messages.openFile, icon: IconFile, group: "open", visible: ([node]) => node?.hasChildren === false, run: ([node]) => onOpen(node!.id, { preview: false }) },
        { id: "window", label: messages.openInWindow, icon: IconExternalLink, group: "open", visible: ([node]) => Boolean(onOpenInWindow) && node?.hasChildren === false, run: ([node]) => onOpenInWindow?.(node!.id) },
        { id: "copy", label: messages.copyPath, icon: IconCopy, group: "manage", run: ([node]) => void clipboard.copy(node!.id) },
        { id: "delete", label: messages.delete, icon: IconTrash, group: "danger", visible: ([node]) => Boolean(node && providerOf(node.id)?.delete), run: ([node]) => setPendingDelete(node!) },
      ]),
    [clipboard, messages, onOpen, onOpenInWindow, providerOf],
  )

  const rowWrapper = useCallback(
    (node: TreeNode, row: ReactElement) => (
      <ActionContextMenu set={actions} targets={[node]} label={node.label}>
        {row}
      </ActionContextMenu>
    ),
    [actions],
  )

  const canRename = providers.some((provider) => provider.rename)
  // A second click keeps the tab the first one opened as a preview.
  const keep = (event: MouseEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id][data-kind='leaf']")
    if (row?.dataset.rowId) onOpen(row.dataset.rowId, { preview: false })
  }

  return (
    <div className="gux-file-explorer" onDoubleClick={keep}>
      <Tree
        ref={tree}
        aria-label={messages.files}
        nodes={nodes}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectedId={selected ?? null}
        groupCounts={false}
        query={query}
        rowWrapper={rowWrapper}
        onLoadChildren={onLoadChildren}
        onRename={
          canRename
            ? async (id, name) => {
                const parent = parentOf(id)
                await providerOf(id)?.rename?.(id, `${parent}/${encodeURIComponent(name)}`, { signal: new AbortController().signal })
                await refresh(parent)
              }
            : undefined
        }
        onSelectedIdChange={(id, details) => {
          if (id && details.item?.hasChildren === false) onOpen(id, { preview: true })
        }}
      />
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete ? messages.deleteTitle({ name: pendingDelete.label }) : ""}
        description={messages.deleteBody}
        confirmLabel={messages.delete}
        cancelLabel={messages.cancel}
        tone="danger"
        onConfirm={async () => {
          const node = pendingDelete
          if (!node) return
          await providerOf(node.id)?.delete?.(node.id, { signal: new AbortController().signal })
          await refresh(parentOf(node.id))
          workbench?.store.close(node.id)
        }}
      />
    </div>
  )
}

