/** The workbench frame every full-window mock-up shares. */
import { createContext, use, useState, type ReactNode } from "react"
import { Button } from "glass-ux/button"
import { StatusDot } from "glass-ux/badge"
import { FileIcon } from "glass-ux/file-icon"
import { Kbd } from "glass-ux/kbd"
import { Menu } from "glass-ux/menu"
import { Surface } from "glass-ux/surface"
import { Tabs } from "glass-ux/tabs"
import { Tree, type TreeNode } from "glass-ux/tree"
import {
  IconBolt,
  IconChevronRight,
  IconClose,
  IconCode,
  IconColumns,
  IconFolder,
  IconHistory,
  IconMoreHorizontal,
  IconSearch,
  IconSettings,
  IconTag,
  IconUser,
} from "glass-ux/icons"
import { CodeSurface, cellStyle } from "./editor-mock"
import { COMPLETIONS, PROBLEMS, QUEUE_SOURCE } from "./fixtures"

/* ── Words: the two languages the mock-up shows, standing in for defineMessages ──────── */

const WORDS = {
  en: {
    file: "File", edit: "Edit", selection: "Selection", view: "View", go: "Go", run: "Run", terminal: "Terminal", help: "Help",
    explorer: "Explorer", search: "Search", scm: "Source control", history: "History", extensions: "Extensions", debug: "Run and debug",
    settings: "Settings", account: "Account", commandSearch: "Search files and commands", problems: "Problems", output: "Output",
    outline: "Outline", ln: "Ln", col: "Col", spaces: "Spaces", saved: "Saved", formatOnSave: "Format on save", split: "Split editor",
    more: "More actions", close: "Close", openEditors: "Open editors", typescript: "TypeScript",
    errors: "2 errors", warnings: "2 warnings", position: "Ln 36, Col 25",
  },
  ar: {
    file: "ملف", edit: "تحرير", selection: "تحديد", view: "عرض", go: "انتقال", run: "تشغيل", terminal: "الطرفية", help: "مساعدة",
    explorer: "المستكشف", search: "بحث", scm: "التحكم بالمصدر", history: "السجل", extensions: "الإضافات", debug: "تشغيل وتصحيح",
    settings: "الإعدادات", account: "الحساب", commandSearch: "البحث في الملفات والأوامر", problems: "المشكلات", output: "المخرجات",
    outline: "المخطط", ln: "سطر", col: "عمود", spaces: "مسافات", saved: "محفوظ", formatOnSave: "التنسيق عند الحفظ", split: "تقسيم المحرر",
    more: "إجراءات أخرى", close: "إغلاق", openEditors: "المحررات المفتوحة", typescript: "TypeScript",
    errors: "خطآن", warnings: "تحذيران", position: "سطر 36، عمود 25",
  },
} as const

export const LocaleContext = createContext<keyof typeof WORDS>("en")
export const useWords = () => WORDS[use(LocaleContext)]

/* ── Icons the library has not drawn yet (see DESIGN.md, Upstream requests) ─────────── */

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em" aria-hidden>
      {children}
    </svg>
  )
}
export const IconSave = () => (
  <Glyph>
    <path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
    <path d="M8 4v5h7V4M8 20v-7h8v7" />
  </Glyph>
)

/* ── Menubar: stands in for the upcoming glass-ux Menubar ───────────────────────────── */

function MenuTitle({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button variant="ghost" size="xs" />}>{label}</Menu.Trigger>
      <Menu.Popup>{children}</Menu.Popup>
    </Menu.Root>
  )
}

export function Title({ phoneTitle, search, end }: { phoneTitle?: string; search?: ReactNode; end?: ReactNode }) {
  const words = useWords()
  return (
    <header className="ide-title">
      <span className="ide-brand" aria-hidden>
        <IconCode />
      </span>
      <span className="ide-title-phone">{phoneTitle}</span>
      <nav className="ide-menubar" aria-label="Application menu">
        <MenuTitle label={words.file}>
          <Menu.Item shortcut="mod+n">New file</Menu.Item>
          <Menu.Item shortcut="mod+o">Open file</Menu.Item>
          <Menu.Item shortcut="mod+shift+o">Open location</Menu.Item>
          <Menu.Separator />
          <Menu.Item icon={<IconSave />} shortcut="mod+s">Save</Menu.Item>
          <Menu.Item shortcut="mod+shift+s">Save as</Menu.Item>
          <Menu.Item shortcut="mod+alt+s">Save all</Menu.Item>
          <Menu.Separator />
          <Menu.Item shortcut="mod+w">Close editor</Menu.Item>
        </MenuTitle>
        <MenuTitle label={words.edit}>
          <Menu.Item shortcut="mod+z">Undo</Menu.Item>
          <Menu.Item shortcut="mod+shift+z">Redo</Menu.Item>
          <Menu.Item>Undo history</Menu.Item>
          <Menu.Separator />
          <Menu.Item shortcut="mod+f">Find</Menu.Item>
          <Menu.Item shortcut="mod+h">Replace</Menu.Item>
          <Menu.Separator />
          <Menu.Item shortcut="shift+alt+f">Format document</Menu.Item>
        </MenuTitle>
        <MenuTitle label={words.selection} />
        <MenuTitle label={words.view} />
        <MenuTitle label={words.go} />
        <MenuTitle label={words.help} />
      </nav>
      {search ?? (
        <button type="button" className="ide-title-search glass-control">
          <IconSearch />
          <span>{words.commandSearch}</span>
          <Kbd keys="mod+p" variant="text" size="sm" />
        </button>
      )}
      {end}
    </header>
  )
}

/* ── Rail ───────────────────────────────────────────────────────────────────────────── */

export type RailView = "explorer" | "search" | "history"

export function Rail({ active, onSettings }: { active: RailView; onSettings?: () => void }) {
  const words = useWords()
  const items: { id: RailView; label: string; icon: ReactNode }[] = [
    { id: "explorer", label: words.explorer, icon: <IconFolder /> },
    { id: "search", label: words.search, icon: <IconSearch /> },
    { id: "history", label: words.history, icon: <IconHistory /> },
  ]
  return (
    <nav className="ide-rail" aria-label="Views">
      {items.map((item) => (
        <span className="ide-rail-item" key={item.id}>
          <Button variant="ghost" size="sm" aria-label={item.label} icon={item.icon} data-active={item.id === active ? "" : undefined} aria-current={item.id === active ? "page" : undefined} />
        </span>
      ))}
      <span className="ide-rail-end">
        <Button variant="ghost" size="sm" aria-label={words.account} icon={<IconUser />} />
      </span>
      <Button variant="ghost" size="sm" aria-label={words.settings} icon={<IconSettings />} onClick={onSettings} />
    </nav>
  )
}

/* ── Status bar ─────────────────────────────────────────────────────────────────────── */

export function StatusItem({ icon, children, tone }: { icon?: ReactNode; children: ReactNode; tone?: "danger" | "warning" | "accent" }) {
  return (
    <span className="ide-status-item" data-tone={tone}>
      {icon}
      {children}
    </span>
  )
}

export function DefaultStatus({ remote }: { remote?: string }) {
  const words = useWords()
  return (
    <>
      {remote ? <StatusItem icon={<StatusDot status="online" label="Connected" />}>{remote}</StatusItem> : null}
      <StatusItem tone="danger">{words.errors}</StatusItem>
      <StatusItem tone="warning">{words.warnings}</StatusItem>
      <span className="ide-status-end">
        <StatusItem>{words.position}</StatusItem>
        <StatusItem>{`${words.spaces}: 2`}</StatusItem>
        <StatusItem>UTF-8</StatusItem>
        <StatusItem>LF</StatusItem>
        <StatusItem>{words.typescript}</StatusItem>
        <StatusItem>{words.formatOnSave}</StatusItem>
      </span>
    </>
  )
}

/* ── Editor tabs ────────────────────────────────────────────────────────────────────── */

export interface TabSpec {
  name: string
  active?: boolean
  dirty?: boolean
  preview?: boolean
}

export function EditorTabs({ tabs, splitControl = true }: { tabs: readonly TabSpec[]; splitControl?: boolean }) {
  const words = useWords()
  return (
    <div className="ide-tabs" role="tablist" aria-label="Open editors">
      {tabs.map((tab) => (
        <div key={tab.name} className="ide-tab" role="tab" aria-selected={!!tab.active} data-active={tab.active ? "" : undefined} data-preview={tab.preview ? "" : undefined}>
          <FileIcon name={tab.name} />
          <span className="ide-tab-name">{tab.name}</span>
          <span className="ide-tab-close" aria-label={tab.dirty ? `${tab.name}, unsaved. ${words.close}` : `${words.close} ${tab.name}`}>
            {tab.dirty ? <i className="ide-tab-dirty" /> : <IconClose />}
          </span>
        </div>
      ))}
      {splitControl ? (
        <span className="ide-tabs-end">
          <Button variant="ghost" size="xs" aria-label={words.split} icon={<IconColumns />} shortcut="mod+\" />
          <Button variant="ghost" size="xs" aria-label={words.more} icon={<IconMoreHorizontal />} />
        </span>
      ) : null}
    </div>
  )
}

export function Crumbs({ parts }: { parts: readonly string[] }) {
  return (
    <nav className="ide-crumbs" aria-label="Breadcrumb">
      {parts.map((part, index) => (
        <span key={part} style={{ display: "contents" }}>
          {index ? <IconChevronRight width="0.75rem" height="0.75rem" /> : null}
          {index === parts.length - 1 ? <b>{part}</b> : <span>{part}</span>}
        </span>
      ))}
    </nav>
  )
}

/* ── Frame ──────────────────────────────────────────────────────────────────────────── */

export function Frame({ rail, side, main, aux, status, overlay, phoneTitle }: {
  rail: RailView
  side: ReactNode
  main: ReactNode
  aux?: ReactNode
  status: ReactNode
  overlay?: ReactNode
  phoneTitle?: string
}) {
  return (
    <div className="ide-app">
      <Title phoneTitle={phoneTitle} />
      <div className="ide-body" data-aux={aux ? "" : undefined}>
        <Rail active={rail} />
        <Surface as="aside" material="chrome" radius="tile" className="ide-side" aria-label="Side view">
          {side}
        </Surface>
        {main}
        {aux ? (
          <Surface as="aside" material="chrome" radius="tile" className="ide-side ide-aux" aria-label="Details">
            {aux}
          </Surface>
        ) : null}
      </div>
      <footer className="ide-status" aria-label="Status bar">
        {status}
      </footer>
      {overlay}
    </div>
  )
}

/** The editor group: opaque, because it holds long scrolling text. */
export function Group({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Surface as="section" material="panel" radius="tile" glass="solid" className="ide-group" aria-label={label}>
      {children}
    </Surface>
  )
}

/* ── Explorer ───────────────────────────────────────────────────────────────────────── */

const leaf = (id: string, status?: "warning" | "error"): TreeNode => ({ id, label: id.split("/").pop()!, icon: <FileIcon name={id} />, status })

export const PROJECT_TREE: TreeNode[] = [
  {
    id: "src",
    label: "src",
    children: [
      { id: "src/storage", label: "storage", children: [leaf("src/storage/journal.ts"), leaf("src/storage/segment.ts")] },
      {
        id: "src/sync",
        label: "sync",
        children: [leaf("src/sync/policy.ts", "warning"), leaf("src/sync/replica-queue.ts", "error"), leaf("src/sync/replica-queue.test.ts"), leaf("src/sync/types.ts")],
      },
      leaf("src/server.ts"),
    ],
  },
  { id: "logs", label: "logs", children: [leaf("logs/events-2026-10.ndjson")] },
  leaf("package.json"),
  leaf("README.md"),
  leaf("tsconfig.json"),
]

const OPEN_FOLDERS = ["src", "src/sync", "logs"]

export function Explorer({ selected = "src/sync/replica-queue.ts", title = "harbour-api", onSelect }: { selected?: string; title?: string; onSelect?: (id: string) => void }) {
  return (
    <>
      <div className="ide-side-head">
        <span className="ide-overline">{title}</span>
        <Button variant="ghost" size="xs" aria-label="Explorer actions" icon={<IconMoreHorizontal />} />
      </div>
      <div className="ide-side-tree">
        <Tree aria-label="Files" nodes={PROJECT_TREE} defaultExpanded={OPEN_FOLDERS} selectedId={selected} groupCounts={false} onSelectedIdChange={(id) => id && onSelect?.(id)} />
      </div>
    </>
  )
}

export function Outline() {
  const words = useWords()
  return (
    <div className="ide-side-section">
      <div className="ide-side-head">
        <span className="ide-overline">{words.outline}</span>
      </div>
      <div className="ide-mono" style={{ paddingInline: "var(--space-3)", color: "var(--fg-muted)", lineHeight: "1.375rem" }}>
        <div>ReplicaQueue</div>
        <div style={{ paddingInlineStart: "1ch" }}>enqueue(replica, event)</div>
        <div style={{ paddingInlineStart: "1ch", color: "var(--accent-text)" }}>flush(replica)</div>
      </div>
    </div>
  )
}

/* ── Bottom panel ───────────────────────────────────────────────────────────────────── */

export function ToneDot({ tone }: { tone: "danger" | "warning" | "info" }) {
  return <StatusDot status={tone === "danger" ? "error" : tone === "warning" ? "warning" : "online"} label={tone} />
}

export function BottomPanel({ initial = "problems" }: { initial?: string }) {
  const words = useWords()
  const [tab, setTab] = useState(initial)
  return (
    <Surface as="section" material="chrome" radius="tile" className="ide-panel" aria-label="Panel">
      <Tabs.Root value={tab} onValueChange={setTab}>
        <div className="ide-panel-head">
          <Tabs.List
            aria-label="Panel views"
            items={[
              { value: "problems", label: words.problems, count: PROBLEMS.length },
              { value: "output", label: words.output },
            ]}
          />
        </div>
      </Tabs.Root>
      <div className="ide-panel-body">
        {tab === "problems"
          ? PROBLEMS.map((item) => (
              <div className="ide-problem" key={item.message}>
                <ToneDot tone={item.tone} />
                <span>{item.message}</span>
                <small>{`${item.file} ${item.line}:${item.col} · ${item.source}(${item.code})`}</small>
              </div>
            ))
          : <div className="ide-terminal"><div data-kind="dim">[completion] connected through this application's backend</div></div>}
      </div>
    </Surface>
  )
}

/* ── The primary editor, used by several screens ────────────────────────────────────── */

export const QUEUE_TABS: readonly TabSpec[] = [
  { name: "replica-queue.ts", active: true, dirty: true },
  { name: "policy.ts" },
  { name: "journal.ts" },
  { name: "README.md", preview: true },
]

export function QueueEditor({ popup }: { popup?: "completion" | "hover" }) {
  return (
    <CodeSurface
      aria-label="replica-queue.ts, TypeScript, 38 lines"
      lines={QUEUE_SOURCE.slice(12)}
      firstLine={13}
      caret={{ line: 23, column: 24 }}
      folds={[3, 11, 14, 16]}
      changes={[{ line: 13, kind: "change" }, { line: 22, kind: "change" }, { line: 23, kind: "add" }]}
      squiggles={[{ line: 14, start: 24, end: 29, tone: "danger" }, { line: 23, start: 23, end: 24, tone: "danger" }, { line: 12, start: 9, end: 17, tone: "warning" }]}
      glyphs={[[14, "danger"], [23, "danger"], [12, "warning"]]}
    >
      {popup === "completion" ? <CompletionPopup /> : null}
      {popup === "hover" ? <HoverPopup /> : null}
    </CodeSurface>
  )
}

function CompletionPopup() {
  return (
    <div className="ide-popup ide-completion" style={{ ...cellStyle(0, 24), insetBlockStart: "19rem" }} role="listbox" aria-label="Suggestions">
      <Surface material="overlay" radius="overlay" className="ide-completion-list">
        {COMPLETIONS.map((item, index) => (
          <div key={item.label} className="ide-completion-row" role="option" aria-selected={index === 1} data-active={index === 1 ? "" : undefined}>
            {item.kind === "method" ? <IconBolt /> : <IconTag />}
            <span className="ide-completion-label">{item.label}</span>
            <span className="ide-completion-detail">{item.detail}</span>
          </div>
        ))}
      </Surface>
      <Surface material="overlay" radius="overlay" className="ide-completion-doc">
        <code>checkpoint(): Promise&lt;Offset&gt;</code>
        Writes the current position and returns its offset. Replay starts from the last checkpoint.
      </Surface>
    </div>
  )
}

function HoverPopup() {
  return (
    <div className="ide-popup" style={cellStyle(14, 8)}>
      <Surface material="overlay" radius="overlay" className="ide-hover">
        <span>
          <b>'queue' is possibly undefined.</b> <small style={{ color: "var(--fg-muted)" }}>ts(strict-null)</small>
        </span>
        <span className="ide-mono">const queue: ReplicaEvent[] | undefined</span>
        <span className="ide-hover-actions">
          <Button size="xs" variant="secondary">Add '?? []'</Button>
          <Button size="xs" variant="ghost">Return early</Button>
          <Button size="xs" variant="ghost" shortcut="mod+.">More fixes</Button>
        </span>
      </Surface>
    </div>
  )
}
