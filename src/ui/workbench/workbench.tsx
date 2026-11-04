import { Activity, useMemo, useState, type ReactNode } from "react"
import { CountBadge } from "glass-ux/badge"
import { useMediaQuery } from "glass-ux/hooks"
import { useMessages } from "glass-ux/i18n"
import { IconCode, IconFile, IconGitBranch, IconHistory, IconKeyboard, IconSearch, IconSettings } from "glass-ux/icons"
import { useShortcutCommands, type ShortcutCommand } from "glass-ux/keymap"
import { AppShell, Rail, SearchTrigger, SHELL_QUERIES, ShellBrand, TabBar, TopBar, TopBarSettingsButton, useShell } from "glass-ux/shell"
import { createWindowManager, Workspace, WindowManagerProvider, type WindowManager } from "glass-ux/windows"
import type { WorkbenchCommand } from "./commands.ts"
import { useWorkbench } from "./context.ts"
import { EditorArea } from "./editor-area.tsx"
import { WorkbenchMenubar } from "./menus.tsx"
import { workbenchMessages } from "./messages.ts"
import { useUnsavedCount } from "./panels.tsx"
import { WorkbenchProvider, type WorkbenchProviderProps } from "./provider.tsx"
import { WorkbenchStatusBar } from "./status.tsx"
import { ChangesView, ExplorerView, SearchView, TimelineView } from "./views.tsx"
import "../../view/editor.css"
import "./workbench.css"

/** A place in the side bar, chosen from the rail. */
export interface WorkbenchView {
  /** A stable id, unique among views. */
  id: string
  /** Names the rail button, and the view's command. */
  label: string
  icon: ReactNode
  /** What the view shows: a `SectionDrawer.Root` and its parts. */
  content: ReactNode
  /** A shortcut that opens the view. */
  keys?: string
  /** A count or dot on the rail button. */
  badge?: ReactNode
}

/** Props of {@link Workbench}. */
export interface WorkbenchProps extends Omit<WorkbenchProviderProps, "children"> {
  /** The top-left corner, usually a `ShellBrand`. */
  brand?: ReactNode
  /** Beside the search in the top bar, such as a theme toggle. */
  actions?: ReactNode
  /** The end of the top bar, usually an `AccountButton`. */
  account?: ReactNode
  /** The application's own views, after Explorer, Search and Changes. */
  views?: readonly WorkbenchView[]
  /** A second side pane, usually an `Inspector`. */
  inspector?: ReactNode
  /** The window manager to open code windows in. Default: one of its own. */
  windows?: WindowManager
}

const NO_VIEWS: readonly WorkbenchView[] = []

/**
 * An IDE as one component: application frame, activity rail, side views, tabbed and splittable
 * editors, code windows, panels, menus, commands and a status bar. It fills its parent, which needs
 * a definite height. To use the parts in a shell you already have, start from `WorkbenchProvider`.
 */
export function Workbench({ windows, brand, actions, account, views = NO_VIEWS, inspector, ...provider }: WorkbenchProps) {
  const [own] = useState(() => (windows ? null : createWindowManager({ storageKey: null, channelName: null })))
  return (
    <WindowManagerProvider manager={windows ?? own!}>
      <WorkbenchProvider {...provider}>
        <Frame brand={brand} actions={actions} account={account} views={views} inspector={inspector} />
      </WorkbenchProvider>
    </WindowManagerProvider>
  )
}

function ActivityRail({ views, active, onChoose, label }: { views: readonly WorkbenchView[]; active: string; onChoose(id: string): void; label: string }) {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const shell = useShell()
  return (
    <Rail.Root aria-label={label}>
      {views.map((view) => (
        <Rail.Item
          key={view.id}
          icon={view.icon}
          label={view.label}
          badge={view.badge}
          active={view.id === active && shell.drawerOpen}
          onClick={() => {
            if (view.id === active && shell.drawerOpen) shell.setDrawerOpen(false)
            else {
              onChoose(view.id)
              shell.setDrawerOpen(true)
            }
          }}
        />
      ))}
      <Rail.Spacer />
      <Rail.Item icon={<IconKeyboard />} label={messages.shortcuts} onClick={workbench.showShortcuts} />
      <Rail.Item icon={<IconSettings />} label={messages.appearance} onClick={workbench.showAppearance} />
    </Rail.Root>
  )
}

function PhoneTabs({ views, active, onChoose, label }: { views: readonly WorkbenchView[]; active: string; onChoose(id: string): void; label: string }) {
  const shell = useShell()
  return (
    <TabBar.Root aria-label={label}>
      {views.map((view) => (
        <TabBar.Item
          key={view.id}
          icon={view.icon}
          label={view.label}
          active={view.id === active && shell.drawerOpen}
          onClick={() => {
            onChoose(view.id)
            shell.setDrawerOpen(true)
          }}
        />
      ))}
    </TabBar.Root>
  )
}

function ViewCommands({ commands }: { commands: readonly WorkbenchCommand[] }) {
  const shell = useShell()
  useShortcutCommands(useMemo(() => commands.map((item) => ({ ...item, run: () => {
    item.run()
    shell.setDrawerOpen(true)
  }, textEntry: "inputs" as const })), [commands, shell]) as readonly ShortcutCommand[])
  return null
}

function Frame({ brand, actions, account, views, inspector }: Pick<WorkbenchProps, "brand" | "actions" | "account" | "inspector"> & { views: readonly WorkbenchView[] }) {
  const messages = useMessages(workbenchMessages)
  const workbench = useWorkbench()
  const unsaved = useUnsavedCount()
  const [active, setActive] = useState("explorer")
  // A phone's tab bar floats over the foot of the screen, so the status bar stays in the workspace.
  const phone = useMediaQuery(SHELL_QUERIES.phone)

  const all = useMemo<WorkbenchView[]>(() => [
    { id: "explorer", label: messages.explorer, icon: <IconFile />, keys: "mod+shift+e", content: <ExplorerView /> },
    { id: "search", label: messages.search, icon: <IconSearch />, keys: "mod+shift+f", content: <SearchView /> },
    { id: "changes", label: messages.changes, icon: <IconGitBranch />, keys: "mod+shift+g", badge: unsaved ? <CountBadge value={unsaved} overlay /> : undefined, content: <ChangesView /> },
    { id: "timeline", label: messages.timeline, icon: <IconHistory />, keys: "mod+shift+h", content: <TimelineView /> },
    ...views,
  ], [messages, unsaved, views])

  const viewCommands = useMemo<WorkbenchCommand[]>(() => all.map((view) => ({ id: `view.${view.id}`, label: view.label, group: messages.view, keys: view.keys, run: () => setActive(view.id) })), [all, messages])

  return (
    <div className="gux-workbench">
      <AppShell
        contentAs="div"
        focusRegions
        className="gux-workbench-shell"
        brand={brand ?? <ShellBrand href="#" label={messages.editor} mark={<IconCode />} />}
        rail={<ActivityRail views={all} active={active} onChoose={setActive} label={messages.navigation} />}
        tabBar={<PhoneTabs views={all} active={active} onChoose={setActive} label={messages.navigation} />}
        inspector={inspector}
        drawer={all.map((view) => (
          <Activity key={view.id} mode={view.id === active ? "visible" : "hidden"}>
            {view.content}
          </Activity>
        ))}
        topBar={
          <TopBar
            module={<WorkbenchMenubar viewCommands={viewCommands} />}
            search={<SearchTrigger shortcut="" onOpen={workbench.quickOpen} />}
            actions={
              <>
                {actions}
                <TopBarSettingsButton label={messages.appearance} onClick={workbench.showAppearance} />
              </>
            }
            account={account}
          />
        }
      >
        <ViewCommands commands={viewCommands} />
        <Workspace primary={<EditorArea className="gux-workbench-editors" />} primaryLabel={messages.editor} className="gux-workbench-stage" />
        {phone ? <WorkbenchStatusBar className="gux-workbench-status" /> : null}
      </AppShell>
      {phone ? null : <WorkbenchStatusBar className="gux-workbench-status" />}
    </div>
  )
}
