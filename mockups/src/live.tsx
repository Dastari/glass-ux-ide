/**
 * The real Workbench, in a host written the way an application would write one: it supplies files
 * and a small fictional language backend, and everything else comes from the package.
 */
import type { FileProvider } from "glass-ux/file-provider"
import { memoryFiles } from "glass-ux/file-provider/memory"
import { IconCode } from "glass-ux/icons"
import { ThemeToggle } from "glass-ux/shell"
import type { CompletionItem, Diagnostic, IdeBackend } from "../../src/backend/index.ts"
import { syntheticSource } from "../../src/core/index.ts"
import DocumentWorker from "../../src/core/document-worker.ts?worker&inline"
import { typescriptLexer } from "../../src/languages/typescript/lexer.ts"
import { Workbench } from "../../src/ui/workbench/index.ts"
import { QUEUE_SOURCE } from "./fixtures"

const SOURCES: Record<string, string> = {
  "src/sync/replica-queue.ts": QUEUE_SOURCE.join("\n").replace("return this.journal.", "return this.journal.size") + "\n",
  "src/sync/policy.ts": `export interface RetryPolicy {\n  attempts: number\n  baseMs: number\n}\n\n/** Waits longer after each failed attempt. */\nexport function backoff(policy: RetryPolicy, attempt: number) {\n  const delay = policy.baseMs * 2 ** attempt\n  return new Promise((resolve) => setTimeout(resolve, delay))\n}\n`,
  "src/sync/types.ts": `export interface Replica {\n  id: string\n  send(event: ReplicaEvent): Promise<boolean>\n}\n\nexport interface ReplicaEvent {\n  kind: "upsert" | "remove"\n  key: string\n  at: number\n}\n`,
  "src/sync/replica-queue.test.ts": `import { describe, expect, it } from "vitest"\nimport { ReplicaQueue } from "./replica-queue"\n\ndescribe("ReplicaQueue", () => {\n  it("delivers events in order", async () => {\n    const seen: string[] = []\n    expect(seen).toEqual([])\n  })\n})\n`,
  "src/storage/journal.ts": `/** Append-only storage for events that have not been delivered. */\nexport class Journal {\n  /* Offsets are bytes,\n     from the start of the segment. */\n  private offset = 0\n\n  async append(id: string, event: unknown) {\n    this.offset += JSON.stringify({ id, event }).length\n    return this.offset\n  }\n}\n`,
  "src/storage/segment.ts": `export const SEGMENT_BYTES = 64 * 1024 * 1024\n`,
  "src/server.ts": `import { ReplicaQueue } from "./sync/replica-queue"\n\nconst port = Number(process.env.PORT ?? 8080)\nconsole.log(\`listening on \${port}\`)\n`,
  "package.json": `{\n  "name": "harbour-api",\n  "version": "1.4.0",\n  "type": "module"\n}\n`,
  "tsconfig.json": `{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n`,
  "README.md": `# harbour-api\n\nDelivers replica events in order.\n\n日本語のテキストと 🙂 絵文字 also work here.\n`,
}


/** A generated file behind a real provider: no write, so it opens read-only for saving. */
function logFiles(): FileProvider {
  const size = 100 * 1024 ** 3
  const source = syntheticSource({ size })
  const file = { uri: "logs:///events-2026-10.ndjson", name: "events-2026-10.ndjson", kind: "file" as const, size, version: "1" }
  return {
    scheme: "logs",
    label: "Logs",
    stat: async () => file,
    read: (_uri, { offset, length }) => source.read(offset, Math.min(length, size - offset)),
    readDirectory: async () => ({ entries: [file], cursor: null }),
  }
}

const MEMBERS: CompletionItem[] = [
  { label: "append", kind: "method", detail: "(id: string, event: ReplicaEvent) => Promise<void>" },
  { label: "checkpoint", kind: "method", detail: "() => Promise<Offset>" },
  { label: "compact", kind: "method", detail: "(before: Offset) => Promise<number>" },
  { label: "flushed", kind: "field", detail: "Offset" },
  { label: "replay", kind: "method", detail: "(from?: Offset) => AsyncIterable<ReplicaEvent>" },
  { label: "size", kind: "field", detail: "number" },
]

/** What an application's language service does, here reduced to a few lines. */
function demoBackend(files: readonly FileProvider[]): IdeBackend & { files: readonly FileProvider[] } {
  return {
    files,
    completion: {
      triggerCharacters: ["."],
      async provideCompletions(_document, _position, _context, signal) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        signal.throwIfAborted()
        return MEMBERS
      },
    },
    diagnostics: {
      subscribe(uri, report) {
        const lines = (SOURCES[uri.replace("project:///", "")] ?? "").split("\n")
        const found: Diagnostic[] = lines.flatMap((text, line) => {
          const at = text.indexOf("flushing = false")
          return at < 0 ? [] : [{ severity: "warning" as const, source: "demo", message: "'flushing' is shared by every replica.", range: { start: { line, column: at }, end: { line, column: at + 8 } } }]
        })
        report(found)
        return () => undefined
      },
    },
  }
}

const project = memoryFiles(SOURCES, { scheme: "project", label: "harbour-api" })
Object.assign(globalThis, { demoProject: project })
const backend = demoBackend([project, logFiles()])

export function LiveScreen() {
  return (
    <div className="ide-app-live">
      <Workbench
        backend={backend}
        lexers={{ ts: typescriptLexer, tsx: typescriptLexer }}
        initialFiles={["project:///src/sync/replica-queue.ts"]}
        createWorker={() => new DocumentWorker()}
        brand={<span className="ide-live-brand" aria-hidden><IconCode /></span>}
        actions={<ThemeToggle />}
        storageKey="glass-ux-ide.demo"
      />
    </div>
  )
}
