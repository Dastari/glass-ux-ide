import { use, useCallback, useSyncExternalStore } from "react"
import { FileIcon } from "glass-ux/file-icon"
import { useClipboard } from "glass-ux/hooks"
import { useMessages } from "glass-ux/i18n"
import { IconArrowLeftRight, IconCopy, IconExternalLink, IconSplitHorizontal } from "glass-ux/icons"
import { Menu } from "glass-ux/menu"
import { PaneLayout, type PaneDefinition } from "glass-ux/pane-layout"
import { WorkbenchLayoutContext, useWorkbench } from "./context.ts"
import { EditorPanel } from "./editor-panel.tsx"
import { workbenchMessages } from "./messages.ts"
import { ChangesPanel, OutputPanel, ProblemsPanel, WelcomePanel } from "./panels.tsx"
import { isDirty, uriOfChanges, uriOfPanel } from "./store.ts"

/**
 * The tabbed, splittable editors and the panels beneath them. Drag a tab to split, or use its
 * menu. It fills its parent, which needs a definite height.
 */
export function EditorArea({ className }: { className?: string }) {
  const workbench = useWorkbench()
  const area = use(WorkbenchLayoutContext)!
  const messages = useMessages(workbenchMessages)
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const clipboard = useClipboard()
  const { confirmClose, nameOf, openInWindow, panels, showChanges, splitEditor, store } = workbench

  const panel = useCallback((id: string): PaneDefinition | null => {
    const uri = uriOfPanel(id)
    if (uri) {
      const record = records.find((item) => item.uri === uri)
      return {
        title: nameOf(uri),
        icon: <FileIcon name={uri} />,
        component: EditorPanel,
        whenHidden: "run",
        primary: true,
        unsaved: record ? isDirty(record) : false,
        preview: record?.preview ?? false,
        onKeep: () => store.patch(uri, { preview: false }),
        canClose: () => confirmClose(uri, id),
        contextMenu: (
          <>
            {openInWindow ? <Menu.Item icon={<IconExternalLink />} onClick={() => void openInWindow(uri)}>{messages.openInWindow}</Menu.Item> : null}
            <Menu.Item icon={<IconSplitHorizontal />} onClick={() => splitEditor(uri)}>{messages.splitEditor}</Menu.Item>
            <Menu.Item icon={<IconArrowLeftRight />} onClick={() => showChanges(uri)}>{messages.compareWithSaved}</Menu.Item>
            <Menu.Item icon={<IconCopy />} onClick={() => void clipboard.copy(uri)}>{messages.copyPath}</Menu.Item>
          </>
        ),
      }
    }
    const compared = uriOfChanges(id)
    if (compared) return { title: messages.changesTo({ name: nameOf(compared) }), icon: <FileIcon name={compared} />, component: ChangesPanel, primary: true }
    if (id === "welcome") return { title: messages.editor, component: WelcomePanel, closable: false, primary: true, minSize: "10rem" } // tokens:allow PaneLayout takes rem, which follows UI scale
    if (id === "problems") return { title: messages.problems, component: ProblemsPanel, closable: false, minSize: "6rem" } // tokens:allow PaneLayout takes rem, which follows UI scale
    if (id === "output") return { title: messages.output, component: OutputPanel, closable: false, minSize: "6rem" } // tokens:allow PaneLayout takes rem, which follows UI scale
    const own = panels.find((item) => item.id === id)
    return own ? { title: own.title, icon: own.icon, component: own.component, closable: false, minSize: "6rem", whenHidden: own.keepRunning ? "run" : "pause" } : null // tokens:allow PaneLayout takes rem, which follows UI scale
  }, [clipboard, confirmClose, messages, nameOf, openInWindow, panels, records, showChanges, splitEditor, store])

  return <PaneLayout className={className} panel={panel} layout={area.layout} onLayoutChange={area.onLayoutChange} data-focus-region="" />
}
