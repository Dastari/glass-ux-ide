/**
 * Layout changes the workbench makes that `glass-ux/pane-layout` has no single function for. The
 * layout is plain public JSON.
 */
import { openPanel, stackOf, type PaneLayoutState, type PaneNode, type PaneStack } from "glass-ux/pane-layout"

function mapStack(node: PaneNode, id: string, change: (item: PaneStack) => PaneStack): PaneNode {
  if (node.type === "stack") return node.id === id ? change(node) : node
  return { ...node, children: node.children.map((child) => mapStack(child, id, change)) }
}

/**
 * Shows a panel: where it already is, or added to a stack, by default the first. Unlike
 * `openPanel` with a target, a panel already open is never moved.
 */
export function showPanel(layout: PaneLayoutState, id: string, stack?: string): PaneLayoutState {
  if (stackOf(layout.root, id)) return openPanel(layout, id)
  const next = openPanel(layout, id, stack ? { stack } : undefined)
  const home = stackOf(next.root, id)
  return home?.collapsed ? setCollapsed(next, home.id, false) : next
}

/** Hides or shows a stack behind its rail button. */
export function setCollapsed(layout: PaneLayoutState, stack: string, collapsed: boolean): PaneLayoutState {
  return { ...layout, root: mapStack(layout.root, stack, (item) => ({ ...item, collapsed })) }
}

/** Gives a panel a new id where it stands. */
export function replacePanel(layout: PaneLayoutState, from: string, to: string): PaneLayoutState {
  const change = (node: PaneNode): PaneNode => {
    if (node.type === "split") return { ...node, children: node.children.map(change) }
    if (!node.panels.includes(from)) return node
    return { ...node, panels: node.panels.map((id) => (id === from ? to : id)), active: node.active === from ? to : node.active }
  }
  return { ...layout, root: change(layout.root) }
}

/** Stacks holding files always show their tabs, because a tab is where a file's name and state are. */
export function showFileTabs(layout: PaneLayoutState, isFile: (id: string) => boolean): PaneLayoutState {
  const change = (node: PaneNode): PaneNode => {
    if (node.type === "split") return { ...node, children: node.children.map(change) }
    const tabs = node.panels.some(isFile) ? "always" : "auto"
    return (node.tabs ?? "auto") === tabs ? node : { ...node, tabs }
  }
  return { ...layout, root: change(layout.root) }
}
