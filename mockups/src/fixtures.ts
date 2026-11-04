/** Fictional sample data for the mock-ups. Nothing here is a real project, host or person. */

export const QUEUE_SOURCE = `import { backoff, type RetryPolicy } from "./policy"
import { Journal } from "../storage/journal"
import type { Replica, ReplicaEvent } from "./types"

/** Delivers replica events in order and retries the ones that fail. */
export class ReplicaQueue {
  private readonly pending = new Map<string, ReplicaEvent[]>()
  private flushing = false

  constructor(
    private readonly journal: Journal,
    private readonly policy: RetryPolicy = { attempts: 5, baseMs: 250 },
  ) {}

  /** Queues an event and starts a flush when none is running. */
  async enqueue(replica: Replica, event: ReplicaEvent) {
    const queue = this.pending.get(replica.id) ?? []
    queue.push(event)
    this.pending.set(replica.id, queue)
    await this.journal.append(replica.id, event)
    if (!this.flushing) void this.flush(replica)
  }

  private async flush(replica: Replica) {
    this.flushing = true
    const queue = this.pending.get(replica.id)
    for (const event of queue) {
      let attempt = 0
      while (attempt < this.policy.attempts) {
        const delivered = await replica.send(event)
        if (delivered) break
        await backoff(this.policy, attempt++)
      }
    }
    this.flushing = false
    return this.journal.
  }
}`.split("\n")

export const QUEUE_BEFORE = QUEUE_SOURCE.map((line) =>
  line
    .replace("attempts: 5, baseMs: 250", "attempts: 3, baseMs: 500")
    .replace("return this.journal.", "return this.journal.size"),
)

const levels = ["INFO", "INFO", "INFO", "WARN", "INFO", "INFO", "ERROR", "INFO"]
const routes = ["/v2/replicas", "/v2/replicas/sync", "/v2/journal", "/v2/health", "/v2/replicas/drain"]
const regions = ["syd-1", "mel-2", "per-1"]

/** Stable pseudo log lines, so a screenshot is the same every run. */
export function logLine(index: number) {
  const seconds = (index * 7) % 60
  const millis = ((index * 613) % 1000).toString().padStart(3, "0")
  const level = levels[index % levels.length]
  const route = routes[(index * 3) % routes.length]
  const region = regions[index % regions.length]
  const ms = 3 + ((index * 37) % 180)
  return `{"ts":"2026-10-14T03:41:${seconds.toString().padStart(2, "0")}.${millis}Z","level":"${level}","region":"${region}","route":"${route}","ms":${ms},"trace":"${(index * 2654435761 % 4294967296).toString(16).padStart(8, "0")}"}`
}

export const PROBLEMS = [
  { tone: "danger", file: "replica-queue.ts", line: 27, col: 25, code: "strict-null", message: "'queue' is possibly undefined.", source: "ts" },
  { tone: "danger", file: "replica-queue.ts", line: 36, col: 25, code: "no-incomplete", message: "Expected a member name after '.'.", source: "parser" },
  { tone: "warning", file: "replica-queue.ts", line: 25, col: 10, code: "single-flush", message: "'flushing' is shared by every replica; one flush blocks the others.", source: "lint" },
  { tone: "warning", file: "policy.ts", line: 12, col: 3, code: "no-unused-vars", message: "'jitter' is declared but never used.", source: "lint" },
  { tone: "info", file: "journal.ts", line: 64, col: 9, code: "prefer-const", message: "'offset' is never reassigned.", source: "lint" },
] as const

export const COMPLETIONS = [
  { label: "append", detail: "(id: string, event: ReplicaEvent) => Promise<void>", kind: "method" },
  { label: "checkpoint", detail: "() => Promise<Offset>", kind: "method" },
  { label: "compact", detail: "(before: Offset) => Promise<number>", kind: "method" },
  { label: "flushed", detail: "Offset", kind: "field" },
  { label: "path", detail: "string", kind: "field" },
  { label: "replay", detail: "(from?: Offset) => AsyncIterable<ReplicaEvent>", kind: "method" },
  { label: "size", detail: "number", kind: "field" },
] as const

export const HISTORY = [
  { id: "w", label: "Working copy", meta: "Unsaved · 4 edits", when: "now", tone: "accent" },
  { id: "s4", label: "Saved", meta: "+6 −2", when: "14:02", tone: "neutral" },
  { id: "f", label: "Format document", meta: "+3 −3", when: "13:58", tone: "neutral" },
  { id: "s3", label: "Saved", meta: "+1 −1", when: "13:41", tone: "neutral" },
  { id: "g", label: "Commit 4f1c2ab · retry policy", meta: "+12 −4", when: "11:17", tone: "neutral" },
  { id: "e", label: "External change on disk", meta: "Reloaded", when: "10:52", tone: "warning" },
  { id: "o", label: "Opened", meta: "38 lines", when: "09:30", tone: "neutral" },
] as const

export const CONNECTIONS = [
  { name: "harbour-staging", kind: "App backend", host: "harbour-staging:/srv/harbour-api", status: "online", detail: "Registered by this app · 18 ms" },
  { name: "Local folder", kind: "Browser", host: "harbour-api (folder access)", status: "online", detail: "Folder access permission" },
  { name: "This browser", kind: "Browser", host: "opfs:/projects", status: "online", detail: "Stored on this device" },
  { name: "release-feed", kind: "HTTP read-only", host: "cdn.cedarvale.example/logs", status: "idle", detail: "Range requests" },
] as const

export interface Component {
  name: string
  entry: string
  summary: string
}

export const COMPONENTS: { group: string; items: Component[] }[] = [
  {
    group: "Editing",
    items: [
      { name: "CodeEditor", entry: "editor", summary: "The full editor surface for any bounded box." },
      { name: "CodeField", entry: "code-field", summary: "A form field that takes part in Field and Form." },
      { name: "CodeViewer", entry: "editor", summary: "Read-only, with the same scroller and highlighting." },
      { name: "CodeDiff", entry: "diff", summary: "Side-by-side or inline diff of two documents." },
      { name: "LogViewer", entry: "log-viewer", summary: "Tails an append-only source of any size." },
    ],
  },
  {
    group: "Workbench",
    items: [
      { name: "Workbench", entry: "workbench", summary: "Rail, panes, editor groups, panel and status bar." },
      { name: "EditorGroup", entry: "workbench", summary: "Tabs, breadcrumb and one editor, splittable." },
      { name: "EditorTabs", entry: "workbench", summary: "Closable, reorderable tabs with save state." },
      { name: "StatusBar", entry: "workbench", summary: "Position, language, encoding and background work." },
      { name: "IdeMenubar", entry: "workbench", summary: "Binds commands to the glass-ux Menubar." },
    ],
  },
  {
    group: "Views",
    items: [
      { name: "FileExplorer", entry: "views/explorer", summary: "Lazy file tree on any file system provider." },
      { name: "SearchView", entry: "views/search", summary: "Streaming search across files and huge documents." },
      { name: "ProblemsView", entry: "views/problems", summary: "Diagnostics grouped by file, keyboard-first." },
      { name: "OutlineView", entry: "views/outline", summary: "Symbols from the parser, following the caret." },
      { name: "HistoryView", entry: "views/history", summary: "Saves, edits and branches on one timeline." },
    ],
  },
  {
    group: "Backend",
    items: [
      { name: "IdeBackend", entry: "backend", summary: "The interfaces an application implements. Every part is optional." },
      { name: "createRpcBackend", entry: "backend/rpc", summary: "Optional: speaks a documented protocol over your transport." },
      { name: "testBackend", entry: "backend/testing", summary: "Conformance tests for your implementation." },
    ],
  },
]

export const HOOKS = [
  ["useTextDocument(uri)", "Open or share a document handle; suspends until ready."],
  ["useEditor()", "The nearest editor: selections, viewport and commands."],
  ["useSelection(editor)", "The selection as a store; re-renders only when it changes."],
  ["useDiagnostics(uri)", "Live diagnostics for a document, from every source."],
  ["useDocumentHistory(doc)", "Undo, redo, branches and saved versions."],
  ["useBackend()", "The registered backend and which features it provides."],
  ["useFileSystem(scheme)", "A registered provider: read, write, watch, stat."],
  ["useCommand(id)", "Run a command, with its enablement and keybinding."],
  ["useWorkbench()", "Open files, reveal views, split groups, read layout."],
] as const

export const API_ROWS = [
  ["document", "TextDocument", "—", "A handle from createDocument or useTextDocument. Use for files of any size."],
  ["value", "string", "—", "Controlled text. For small content; a large value belongs in a document."],
  ["defaultValue", "string", '""', "Initial text when uncontrolled."],
  ["onValueChange", "(value: string) => void", "—", "Called with the text after an edit. Not called for a document handle."],
  ["language", "LanguageId", '"plain"', "Grammar and language services to attach."],
  ["readOnly", "boolean", "false", "Keeps navigation, selection and copy; refuses edits with the reason."],
  ["wrap", '"off" | "viewport" | "ruler"', '"off"', "Line wrapping. Long lines are windowed in every mode."],
  ["budget", "EditorBudget", "automatic", "Memory and feature limits. Tier is derived from file size."],
  ["aria-label", "string", "required", "Names the editor for assistive technology."],
] as const
