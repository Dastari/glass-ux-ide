import { useEffect, useMemo } from "react"
import { Badge, StatusDot } from "glass-ux/badge"
import { Button } from "glass-ux/button"
import { useCommandPalette, usePaletteCommands, type PaletteCommand } from "glass-ux/command-palette"
import { Dialog } from "glass-ux/dialog"
import { FactList } from "glass-ux/fact-list"
import { Field } from "glass-ux/field"
import { Input, SearchField } from "glass-ux/input"
import { Kbd } from "glass-ux/kbd"
import { Meter } from "glass-ux/meter"
import { Notice } from "glass-ux/notice"
import { Progress } from "glass-ux/progress"
import { Segmented } from "glass-ux/segmented"
import { SettingRow } from "glass-ux/setting-row"
import { Surface, Panel, PanelBody, PanelHeader, PanelFooter } from "glass-ux/surface"
import { Switch } from "glass-ux/switch"
import { WindowFrame } from "glass-ux/windows"
import { IconCheck, IconCloud, IconColumns, IconFile, IconHistory, IconPlus, IconRefresh, IconSearch, IconSettings } from "glass-ux/icons"
import { CodeSurface } from "./editor-mock"
import {
  BottomPanel,
  Crumbs,
  DefaultStatus,
  EditorTabs,
  Explorer,
  Frame,
  Group,
  IconSave,
  Outline,
  QUEUE_TABS,
  QueueEditor,
  StatusItem,
} from "./chrome"
import { API_ROWS, COMPONENTS, CONNECTIONS, HISTORY, HOOKS, QUEUE_BEFORE, QUEUE_SOURCE, logLine } from "./fixtures"

/* ── 1 Workbench ────────────────────────────────────────────────────────────────────── */

export function WorkbenchScreen() {
  return (
    <Frame
      rail="explorer"
      phoneTitle="replica-queue.ts"
      side={
        <>
          <Explorer />
          <Outline />
        </>
      }
      main={
        <div className="ide-main">
          <div className="ide-groups">
            <Group label="Editor">
              <EditorTabs tabs={QUEUE_TABS} />
              <Crumbs parts={["src", "sync", "replica-queue.ts", "ReplicaQueue", "flush"]} />
              <QueueEditor popup="completion" />
            </Group>
          </div>
          <BottomPanel initial="problems" />
        </div>
      }
      status={<DefaultStatus />}
    />
  )
}

/** The same workbench with the error's hover card and the editor split. */
export function SplitScreen() {
  return (
    <Frame
      rail="explorer"
      phoneTitle="replica-queue.ts"
      side={<Explorer />}
      main={
        <div className="ide-main">
          <div className="ide-groups">
            <Group label="Editor group 1">
              <EditorTabs tabs={QUEUE_TABS.slice(0, 2)} />
              <Crumbs parts={["src", "sync", "replica-queue.ts"]} />
              <QueueEditor popup="hover" />
            </Group>
            <Group label="Editor group 2">
              <EditorTabs tabs={[{ name: "replica-queue.ts", active: true, dirty: true }]} splitControl={false} />
              <Crumbs parts={["src", "sync", "replica-queue.ts", "ReplicaQueue"]} />
              <CodeSurface aria-label="replica-queue.ts, second view of the same document" lines={QUEUE_SOURCE.slice(0, 30)} minimap={false} folds={[4, 5]} />
            </Group>
          </div>
          <BottomPanel initial="problems" />
        </div>
      }
      status={<DefaultStatus />}
    />
  )
}

/* ── 2 Huge file ────────────────────────────────────────────────────────────────────── */

const HUGE_START = 226_408_112

export function HugeScreen() {
  const lines = useMemo(() => Array.from({ length: 34 }, (_, index) => logLine(HUGE_START + index)), [])
  const matches = useMemo(
    () =>
      lines.flatMap((line, row) => {
        const at = line.indexOf('"ERROR"')
        return at < 0 ? [] : [[row, at, at + 7] as const]
      }),
    [lines],
  )
  return (
    <Frame
      rail="search"
      phoneTitle="events-2026-10.ndjson"
      side={
        <>
          <div className="ide-side-head">
            <span className="ide-overline">Document</span>
          </div>
          <div className="ide-side-scroll">
            <FactList
              facts={[
                { label: "Size", value: "48.2 GB" },
                { label: "Lines", value: "≈ 370 million" },
                { label: "Longest line", value: "2.1 MB" },
                { label: "Encoding", value: "UTF-8, LF" },
                { label: "Source", value: "Local, read on demand" },
              ]}
            />
            <Progress label="Indexing lines" value={61} size="sm" meta="29.4 GB of 48.2 GB · 1.9 GB/s" />
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <Meter label="Editor memory" value={184} max={512} valueText="184 MB of 512 MB" />
              <Meter label="Undo journal" value={3} max={100} valueText="3 MB on disk" />
            </div>
            <div>
              <div className="ide-overline" style={{ marginBlockEnd: "var(--space-2)" }}>
                Tier 3 · Over 2 GB
              </div>
              <dl className="ide-tier">
                <dt>Editing, undo</dt><dd>On</dd>
                <dt>Search, replace</dt><dd>On, streamed</dd>
                <dt>Highlighting</dt><dd>Visible lines</dd>
                <dt>Folding, outline</dt><dd>Off</dd>
                <dt>Language services</dt><dd>Off</dd>
                <dt>Minimap</dt><dd>Density only</dd>
              </dl>
            </div>
          </div>
        </>
      }
      main={
        <div className="ide-main" style={{ "--ide-panel-h": "10rem" } as React.CSSProperties}>
          <div className="ide-groups">
            <Group label="Editor">
              <EditorTabs tabs={[{ name: "events-2026-10.ndjson", active: true, dirty: true }, { name: "replica-queue.ts" }]} />
              <Crumbs parts={["logs", "events-2026-10.ndjson"]} />
              <CodeSurface aria-label="events-2026-10.ndjson, 48.2 gigabytes" lines={lines} language="log" firstLine={HUGE_START} gutterChars={11} caret={{ line: 6, column: 58 }} matches={matches} minimap="density" changes={[{ line: 11, kind: "change" }]} />
              <Surface material="overlay" radius="control" className="ide-find" role="search" aria-label="Find in document">
                <SearchField aria-label="Find" defaultValue={'"ERROR"'} style={{ inlineSize: "13rem" }} />
                <Button variant="ghost" size="xs" aria-label="Match case" aria-pressed={false}>Aa</Button>
                <Button variant="ghost" size="xs" aria-label="Regular expression" aria-pressed={false}>.*</Button>
                <span className="ide-find-count" data-numeric aria-live="polite">28,301,014 so far · 61%</span>
              </Surface>
            </Group>
          </div>
          <Surface as="section" material="chrome" radius="tile" className="ide-panel" aria-label="Search results">
            <div className="ide-panel-head">
              <span className="ide-overline" style={{ paddingInline: "var(--space-1)" }}>Results, streamed in line order</span>
              <span style={{ display: "flex", gap: "var(--space-1)" }}>
                <Button size="xs" variant="ghost">Stop</Button>
                <Button size="xs" variant="ghost">Replace all</Button>
              </span>
            </div>
            <div className="ide-panel-body">
              {lines.filter((line) => line.includes('"ERROR"')).slice(0, 5).map((line, index) => (
                <div className="ide-result" key={index}>
                  <span data-numeric>{(HUGE_START + lines.indexOf(line)).toLocaleString("en-AU")}</span>
                  <span>
                    {line.slice(0, line.indexOf('"ERROR"'))}
                    <mark>{'"ERROR"'}</mark>
                    {line.slice(line.indexOf('"ERROR"') + 7)}
                  </span>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      }
      status={
        <>
          <StatusItem>Indexing 61%</StatusItem>
          <span className="ide-status-end">
            <StatusItem>{`Ln ≈${(HUGE_START + 6).toLocaleString("en-AU")}, Col 59`}</StatusItem>
            <StatusItem>Byte 29,410,882,116</StatusItem>
            <StatusItem>UTF-8</StatusItem>
            <StatusItem>LF</StatusItem>
            <StatusItem>NDJSON</StatusItem>
            <StatusItem tone="accent">Tier 3</StatusItem>
          </span>
        </>
      }
    />
  )
}

/* ── 3 History ──────────────────────────────────────────────────────────────────────── */

/** The changed words on rows 2 and 26 of the slice from line 10. */
function wordChanges(lines: readonly string[]) {
  const line = lines[11]!
  const attempts = line.indexOf("attempts: ") + 10
  const base = line.indexOf("baseMs: ") + 8
  const end = lines[35]!.length
  return [[2, attempts, attempts + 1], [2, base, base + 3], [26, Math.min(end, 24), Math.max(end, 24)]] as const
}

export function HistoryScreen() {
  return (
    <Frame
      rail="history"
      phoneTitle="replica-queue.ts history"
      side={
        <>
          <div className="ide-side-head">
            <span className="ide-overline">replica-queue.ts</span>
            <Button variant="ghost" size="xs" aria-label="Filter history" icon={<IconSearch />} />
          </div>
          <div className="ide-side-scroll">
            <ol className="ide-timeline" aria-label="Document history">
              {HISTORY.slice(0, 2).map((item, index) => (
                <li key={item.id} data-tone={item.tone} data-active={index === 1 ? "" : undefined}>
                  <i aria-hidden />
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                  <time>{item.when}</time>
                </li>
              ))}
              <li data-branch="" data-tone="neutral">
                <i aria-hidden />
                <span>Undone branch</span>
                <small>9 edits, kept after undo</small>
                <time>13:59</time>
              </li>
              {HISTORY.slice(2).map((item) => (
                <li key={item.id} data-tone={item.tone}>
                  <i aria-hidden />
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                  <time>{item.when}</time>
                </li>
              ))}
            </ol>
            <SettingRow label="Keep after closing" control={<Switch aria-label="Keep history after closing" defaultChecked />} />
          </div>
        </>
      }
      main={
        <div className="ide-main" data-panel="none">
          <div className="ide-groups">
            <Group label="Compare">
              <EditorTabs tabs={[{ name: "replica-queue.ts", active: true }]} />
              <div className="ide-diff-head">
                <b>Saved 14:02</b>
                <span>↔</span>
                <b>Working copy</b>
                <span data-numeric>+2 −2 · 2 changes</span>
                <span className="ide-diff-actions">
                  <Segmented aria-label="Layout" size="sm" defaultValue="split" options={[{ value: "split", label: "Split" }, { value: "inline", label: "Inline" }]} />
                  <Button size="xs" variant="secondary" icon={<IconHistory />}>Restore this version</Button>
                </span>
              </div>
              <div className="ide-diff">
                <CodeSurface
                  aria-label="Saved 14:02"
                  lines={QUEUE_BEFORE.slice(9)}
                  firstLine={10}
                  minimap={false}
                  gutterChars={3}
                  changes={[{ line: 2, kind: "remove" }, { line: 26, kind: "remove" }]}
                  matches={wordChanges(QUEUE_BEFORE)}
                />
                <CodeSurface
                  aria-label="Working copy"
                  lines={QUEUE_SOURCE.slice(9)}
                  firstLine={10}
                  minimap={false}
                  gutterChars={3}
                  changes={[{ line: 2, kind: "add" }, { line: 26, kind: "add" }]}
                  matches={wordChanges(QUEUE_SOURCE)}
                />
              </div>
            </Group>
          </div>
        </div>
      }
      status={<DefaultStatus />}
    />
  )
}

/* ── 4 Remote ───────────────────────────────────────────────────────────────────────── */

function RemoteTree() {
  return (
    <>
      <div className="ide-side-head">
        <span className="ide-overline">Locations</span>
        <Button variant="ghost" size="xs" aria-label="Add location" icon={<IconPlus />} />
      </div>
      <div className="ide-side-scroll">
        <div className="ide-connections">
          {CONNECTIONS.map((item) => (
            <div key={item.name} className="ide-connection" data-active={item.name === "harbour-staging" ? "" : undefined}>
              <StatusDot status={item.status === "online" ? "online" : "offline"} label={item.status} />
              <span>
                <b>{item.name}</b>
                <small>{item.detail}</small>
              </span>
              <span className="ide-connection-kind">{item.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function RemoteScreen({ dialog }: { dialog?: boolean }) {
  return (
    <>
      <Frame
        rail="explorer"
        phoneTitle="replica-queue.ts on harbour-staging"
        side={<RemoteTree />}
        main={
          <div className="ide-main">
            <div className="ide-groups">
              <Group label="Editor">
                <EditorTabs tabs={[{ name: "replica-queue.ts", active: true, dirty: true }, { name: "nginx.conf" }]} />
                <Crumbs parts={["harbour-staging", "srv", "harbour-api", "src", "sync", "replica-queue.ts"]} />
                <QueueEditor />
                <div className="ide-conflict">
                  <Notice tone="warning" compact action={<Button size="xs" variant="secondary" icon={<IconColumns />}>Compare</Button>} title="Save held.">
                    replica-queue.ts changed on harbour-staging at 14:06. Your edits are safe in this tab.
                  </Notice>
                </div>
              </Group>
            </div>
            <BottomPanel initial="problems" />
          </div>
        }
        status={<DefaultStatus remote="harbour-staging · 18 ms" />}
      />
      {dialog ? (
        <Dialog.Root open>
          <Dialog.Popup>
            <Dialog.Header icon={<IconCloud />} title="Open" subtitle="4 locations · 3 available" />
            <Dialog.Body>
              <div style={{ display: "grid", gap: "var(--gap-fields)" }}>
                <Field label="Path or address">
                  <Input defaultValue="harbour-staging:/srv/harbour-api" />
                </Field>
                <div className="ide-connections">
                  {CONNECTIONS.slice(0, 3).map((item, index) => (
                    <Surface key={item.name} material="card" radius="tile" className="ide-connection" data-active={index === 0 ? "" : undefined}>
                      <StatusDot status="online" label="online" />
                      <span>
                        <b>{item.name}</b>
                        <small>{item.host}</small>
                      </span>
                      <span className="ide-connection-kind">{item.kind}</span>
                    </Surface>
                  ))}
                </div>
                <Notice tone="info">
                  Servers appear here when the application registers a backend. Browser locations need nothing extra.
                </Notice>
              </div>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost">Cancel</Button>
              <Button variant="primary">Open</Button>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Root>
      ) : null}
    </>
  )
}

/* ── 5 Command palette ──────────────────────────────────────────────────────────────── */

const NO_OP = () => {}

export function PaletteScreen() {
  const palette = useCommandPalette()
  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: "save", label: "Save", group: "File", icon: <IconSave />, shortcut: "mod+s", run: NO_OP },
      { id: "save-all", label: "Save all", group: "File", icon: <IconSave />, shortcut: "mod+alt+s", run: NO_OP },
      { id: "open-remote", label: "Open location", group: "File", icon: <IconCloud />, shortcut: "mod+shift+o", run: NO_OP },
      { id: "format", label: "Format document", group: "Editor", icon: <IconFile />, shortcut: "shift+alt+f", run: NO_OP },
      { id: "split", label: "Split editor right", group: "Editor", icon: <IconColumns />, shortcut: "mod+\\", run: NO_OP },
      { id: "history", label: "Open document history", group: "Editor", icon: <IconHistory />, run: NO_OP },
      { id: "reload", label: "Reload from disk", group: "File", icon: <IconRefresh />, detail: "replica-queue.ts", run: NO_OP },
      { id: "keys", label: "Keyboard shortcuts", group: "Preferences", icon: <IconSettings />, run: NO_OP },
    ],
    [],
  )
  usePaletteCommands(commands)
  useEffect(() => {
    palette.open()
  }, [])
  return <WorkbenchScreen />
}

/* ── 6 Inside an existing application ───────────────────────────────────────────────── */

const POLICY = `{
  "attempts": 5,
  "baseMs": 250,
  "regions": ["syd-1", "mel-2"],
  "drainOnDeploy": tru
}`.split("\n")

export function EmbedScreen() {
  const logs = useMemo(() => Array.from({ length: 14 }, (_, index) => logLine(9000 + index)), [])
  return (
    <div className="canvas-host ide-page" style={{ background: "none" }}>
      <div className="ide-embed-head">
        <h1>Replica policy</h1>
        <Button variant="primary" icon={<IconCheck />}>Publish</Button>
      </div>
      <div className="ide-page-grid">
        <Panel>
          <PanelHeader title="Policy" />
          <PanelBody>
            <div style={{ display: "grid", gap: "var(--gap-fields)" }}>
              <Field label="Name"><Input defaultValue="Standard replica" /></Field>
              <Field label="Definition" error="Line 5: Expected 'true', 'false' or a value." message="reserve">
                <div className="ide-well" style={{ blockSize: "11rem" }}>
                  <CodeSurface aria-label="Definition, JSON" lines={POLICY} gutterChars={2} minimap={false} caret={{ line: 4, column: 22 }} squiggles={[{ line: 4, start: 19, end: 22, tone: "danger" }]} />
                </div>
              </Field>
            </div>
          </PanelBody>
          <PanelFooter>
            <span className="ide-mono" style={{ color: "var(--fg-muted)" }}>{'<CodeField language="json" />'}</span>
          </PanelFooter>
        </Panel>

        {/* A window is a size container: it needs a definite height (R7.3). */}
        <div style={{ blockSize: "25rem" }}>
        <WindowFrame.Root state="tiled" style={{ blockSize: "100%" }}>
          <WindowFrame.AppBar title="release-notes.md" />
          <WindowFrame.Body>
            <div className="ide-window-body" style={{ blockSize: "100%" }}>
              <EditorTabs tabs={[{ name: "release-notes.md", active: true, dirty: true }]} />
              <CodeSurface aria-label="release-notes.md" lines={QUEUE_SOURCE.slice(4, 24)} gutterChars={3} minimap={false} caret={{ line: 3, column: 8 }} />
            </div>
          </WindowFrame.Body>
          <WindowFrame.StatusBar>
            <WindowFrame.StatusItem>{'<CodeEditor document={doc} />'}</WindowFrame.StatusItem>
          </WindowFrame.StatusBar>
        </WindowFrame.Root>
        </div>

        <Panel>
          <PanelHeader title="Delivery log" actions={<Badge tone="success">Live</Badge>} />
          <PanelBody>
            <div className="ide-well" style={{ blockSize: "12rem" }}>
              <CodeSurface aria-label="Delivery log" lines={logs} language="log" firstLine={1_204_118} gutterChars={9} minimap={false} />
            </div>
          </PanelBody>
          <PanelFooter>
            <span className="ide-mono" style={{ color: "var(--fg-muted)" }}>{'<LogViewer source={stream} follow />'}</span>
          </PanelFooter>
        </Panel>

        <Panel>
          <PanelHeader title="Change for approval" actions={<Badge tone="warning">2 changes</Badge>} />
          <PanelBody>
            <div className="ide-well ide-diff" style={{ blockSize: "12rem" }}>
              <CodeSurface aria-label="Before" lines={QUEUE_BEFORE.slice(9, 16)} firstLine={10} gutterChars={2} minimap={false} changes={[{ line: 2, kind: "remove" }]} />
              <CodeSurface aria-label="After" lines={QUEUE_SOURCE.slice(9, 16)} firstLine={10} gutterChars={2} minimap={false} changes={[{ line: 2, kind: "add" }]} />
            </div>
          </PanelBody>
          <PanelFooter>
            <span className="ide-mono" style={{ color: "var(--fg-muted)" }}>{'<CodeDiff before={a} after={b} />'}</span>
          </PanelFooter>
        </Panel>
      </div>
    </div>
  )
}

/* ── What runs where ────────────────────────────────────────────────────────────────── */

const WHERE = [
  ["Editing, undo, history, huge files", "Built in", "Nothing needed"],
  ["Syntax highlighting", "Built in", "Nothing needed"],
  ["Files", "Memory, browser storage, local folder, HTTP read", "Any store: FileSystemProvider"],
  ["Saving a huge file", "Rewrites the file", "Sends only the edits: applyEdits"],
  ["Search", "Open documents and browser files", "Whole project: SearchProvider"],
  ["Formatting", "Optional built-in formatter", "FormatProvider"],
  ["Autocomplete", "Words in open files, snippets", "CompletionProvider"],
  ["Problems", "Syntax errors", "DiagnosticsProvider"],
  ["Hover, go to definition, rename", "—", "Language providers"],
  ["Sign-in and permissions", "—", "Your application"],
  ["Terminal, Git, debugging", "—", "Your own views, added to the workbench"],
] as const

const BACKEND_SAMPLE = [
  "const backend: IdeBackend = {",
  "  files: [myFiles],",
  "  completion: { provideCompletions: (doc, position, context) => api.complete(doc.uri, position, context) },",
  "  diagnostics: { subscribe: (uri, report) => api.watchProblems(uri, report) },",
  "}",
  "",
  "return <Workbench backend={backend} languages={[typescript, json]} />",
]

export function BackendScreen() {
  return (
    <div className="ide-page">
      <div className="ide-embed-head">
        <h1>What runs where</h1>
      </div>
      <Surface material="card" radius="tile" padding="tile">
        <table className="ide-api">
          <thead>
            <tr><th>Feature</th><th>In the browser alone</th><th>With your backend</th></tr>
          </thead>
          <tbody>
            {WHERE.map(([feature, browser, host]) => (
              <tr key={feature}><td>{feature}</td><td>{browser}</td><td>{host}</td></tr>
            ))}
          </tbody>
        </table>
      </Surface>
      <div className="ide-overline ide-section-title">Connecting a backend</div>
      <div className="ide-demo" style={{ blockSize: "auto" }}>
        <CodeSurface aria-label="Backend example" lines={BACKEND_SAMPLE} gutterChars={2} minimap={false} />
      </div>
    </div>
  )
}

/* ── 7 Components and hooks ─────────────────────────────────────────────────────────── */

export function ComponentsScreen() {
  return (
    <div className="ide-page">
      {COMPONENTS.map((group) => (
        <section key={group.group}>
          <div className="ide-overline ide-section-title">{group.group}</div>
          <div className="ide-sheet-grid">
            {group.items.map((item) => (
              <Surface key={item.name} material="card" radius="tile" padding="tile" className="ide-sheet-card">
                <b>{item.name}</b>
                <code>glass-ux-ide/{item.entry}</code>
                <p>{item.summary}</p>
              </Surface>
            ))}
          </div>
        </section>
      ))}
      <div className="ide-overline ide-section-title">Hooks</div>
      <Surface material="card" radius="tile" padding="tile">
        <dl className="ide-hook">
          {HOOKS.map(([name, summary]) => [<dt key={name}>{name}</dt>, <dd key={summary}>{summary}</dd>])}
        </dl>
      </Surface>
    </div>
  )
}

/* ── 8 Documentation site ───────────────────────────────────────────────────────────── */

const DOC_NAV = ["Getting started", "Text documents", "Backends", "Languages", "CodeEditor", "CodeField", "CodeViewer", "CodeDiff", "LogViewer", "Workbench", "EditorTabs", "FileExplorer", "SearchView", "Hooks"]

export function DocsScreen() {
  return (
    <div className="ide-docs">
      <Surface as="nav" material="chrome" radius="surface" className="ide-docs-nav" aria-label="Documentation">
        <div style={{ marginBlockEnd: "var(--space-3)" }}><SearchField aria-label="Find a component" placeholder="Search" /></div>
        {DOC_NAV.map((item) => (
          <a key={item} data-active={item === "CodeEditor" ? "" : undefined}>{item}</a>
        ))}
      </Surface>
      <div className="ide-docs-scroll">
        <article className="ide-docs-article">
          <h1>CodeEditor</h1>
          <p>Edits a document of any size in a bounded box. Give the parent a definite height.</p>
          <div className="ide-demo">
            <EditorTabs tabs={[{ name: "replica-queue.ts", active: true, dirty: true }]} splitControl={false} />
            <CodeSurface aria-label="Demo editor" lines={QUEUE_SOURCE.slice(14, 26)} firstLine={15} caret={{ line: 3, column: 16 }} gutterChars={3} minimap={false} />
          </div>
          <h2>Usage</h2>
          <div className="ide-demo" style={{ blockSize: "auto" }}>
            <CodeSurface
              aria-label="Usage"
              gutterChars={2}
              minimap={false}
              lines={[
                'import { CodeEditor, useTextDocument } from "glass-ux-ide/editor"',
                "",
                "const doc = useTextDocument(uri)",
                'return <CodeEditor document={doc} language="typescript" aria-label="Source" />',
              ]}
            />
          </div>
          <h2>Props</h2>
          <table className="ide-api">
            <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
            <tbody>
              {API_ROWS.map(([name, type, fallback, summary]) => (
                <tr key={name}><td><code>{name}</code></td><td><code>{type}</code></td><td>{fallback}</td><td>{summary}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>Keyboard</h2>
          <table className="ide-api">
            <tbody>
              <tr><td><Kbd keys="ctrl+m" /></td><td>Tab moves focus instead of indenting, until pressed again</td></tr>
              <tr><td><Kbd keys="f6" /></td><td>Moves to the next region of the workbench</td></tr>
              <tr><td><Kbd keys="alt+f1" /></td><td>Opens the accessibility help for the focused editor</td></tr>
            </tbody>
          </table>
          <h2>Accessibility</h2>
          <table className="ide-api">
            <tbody>
              <tr><td>Role</td><td><code>textbox</code> with <code>aria-multiline</code>, and <code>aria-label</code> is required</td></tr>
              <tr><td>Screen readers</td><td>The current page of text lives in the input element, so lines read in full and the caret tracks</td></tr>
              <tr><td>Announcements</td><td>Diagnostics, search counts and save results use polite live regions that stay mounted</td></tr>
              <tr><td>Checked in</td><td>Light, dark, Solid, forced colours, 200% zoom, NVDA, VoiceOver and Orca</td></tr>
            </tbody>
          </table>
          <h2>Translations</h2>
          <p>Every built-in word is a message in the <code>editor</code> namespace, with packs for the 11 languages Glass UX ships beside English. Code always reads left to right; the frame around it follows the page direction.</p>
        </article>
        <nav className="ide-docs-rail" aria-label="On this page">
          <a data-active>Examples</a><a>Usage</a><a>Props</a><a>Handle</a><a>Keyboard</a><a>Accessibility</a><a>Translations</a>
        </nav>
      </div>
    </div>
  )
}

/* ── 9 Accessibility map ────────────────────────────────────────────────────────────── */

const Note = ({ n, children, style }: { n: number; children: string; style: React.CSSProperties }) => (
  <span className="ide-a11y-note" style={style}>
    <b>{n}</b>
    {children}
  </span>
)

export function A11yScreen() {
  return (
    <Frame
      rail="explorer"
      phoneTitle="Accessibility"
      side={<Explorer />}
      main={
        <div className="ide-main">
          <div className="ide-groups">
            <Group label="Editor">
              <EditorTabs tabs={QUEUE_TABS} />
              <Crumbs parts={["src", "sync", "replica-queue.ts", "ReplicaQueue", "flush"]} />
              <QueueEditor />
            </Group>
          </div>
          <BottomPanel initial="problems" />
        </div>
      }
      aux={
        <>
          <div className="ide-side-head"><span className="ide-overline">Accessibility</span></div>
          <div className="ide-side-scroll">
            <SettingRow label="Screen reader mode" description="Detected. Lines are read in full." control={<Switch aria-label="Screen reader mode" defaultChecked />} />
            <SettingRow label="Announce diagnostics" control={<Switch aria-label="Announce diagnostics" defaultChecked />} />
            <SettingRow label="Sound on error line" control={<Switch aria-label="Sound on error line" />} />
            <Notice tone="info" title="Last announcement">Line 36. Error: Expected a member name after '.'.</Notice>
            <table className="ide-api">
              <tbody>
                <tr><td><Kbd keys="f6" /></td><td>Next region</td></tr>
                <tr><td><Kbd keys="ctrl+m" /></td><td>Tab moves focus</td></tr>
                <tr><td><Kbd keys="f8" /></td><td>Next problem</td></tr>
                <tr><td><Kbd keys="alt+f1" /></td><td>Editor help</td></tr>
                <tr><td><Kbd keys="shift+f10" /></td><td>Context menu</td></tr>
              </tbody>
            </table>
          </div>
        </>
      }
      overlay={
        <>
          <Note n={1} style={{ insetBlockStart: "0.5rem", insetInlineStart: "30.5rem" }}>Menubar</Note>
          <Note n={2} style={{ insetBlockStart: "40rem", insetInlineStart: "0.375rem" }}>Views</Note>
          <Note n={3} style={{ insetBlockStart: "40rem", insetInlineStart: "7.5rem" }}>Side view</Note>
          <Note n={4} style={{ insetBlockStart: "2.875rem", insetInlineStart: "56rem" }}>Tabs</Note>
          <Note n={5} style={{ insetBlockStart: "12rem", insetInlineStart: "50rem" }}>Editor</Note>
          <Note n={6} style={{ insetBlockEnd: "11.75rem", insetInlineStart: "42rem" }}>Panel</Note>
          <Note n={7} style={{ insetBlockEnd: "0.125rem", insetInlineStart: "30rem" }}>Status bar</Note>
        </>
      }
      status={<DefaultStatus />}
    />
  )
}

