/** A bare page for driving the real editor: no React, no glass-ux. The browser tests use it. */
import { memoryFiles } from "glass-ux/file-provider/memory"
import { testFileProvider } from "glass-ux/testing/file-provider"
import { browserFiles, openFile } from "../../src/backend/index.ts"
import { SaveConflictError } from "../../src/core/index.ts"
import { connectDocument, type SourceSpec } from "../../src/core/worker.ts"
import { typescriptLexer } from "../../src/languages/typescript/lexer.ts"
import { EditorView } from "../../src/view/index.ts"
import "../../src/view/editor.css"

const SAMPLE = `import { backoff, type RetryPolicy } from "./policy"

/** Delivers replica events in order and retries the ones that fail. */
export class ReplicaQueue {
  private readonly pending = new Map<string, ReplicaEvent[]>()

  /* A comment that
     runs across lines. */
  async enqueue(replica: Replica, event: ReplicaEvent) {
    const queue = this.pending.get(replica.id) ?? []
    queue.push(event)
    return \`queued \${queue.length} for \${replica.id}\`
  }
}
日本語のテキストと 🙂 絵文字
`

const params = new URLSearchParams(location.search)
const name = params.get("doc") ?? "sample"
const specs: Record<string, SourceSpec> = {
  sample: { kind: "bytes", bytes: new TextEncoder().encode(params.get("text") ?? SAMPLE) },
  huge: { kind: "synthetic", size: 100 * 1024 ** 3 },
  hostile: { kind: "bytes", bytes: new TextEncoder().encode("x".repeat(3_000_000)) },
}

const status = document.querySelector<HTMLElement>("#status")!
const mount = document.querySelector<HTMLElement>("#editor")!
let view: EditorView | null = null

async function open(spec: SourceSpec, label: string, lexer?: typeof typescriptLexer) {
  view?.dispose()
  const worker = new Worker(new URL("../../src/core/document-worker.ts", import.meta.url), { type: "module" })
  const handle = await connectDocument(worker, spec, spec.kind === "synthetic" ? { index: false } : {})
  view = new EditorView(mount, {
    handle,
    lexer,
    ariaLabel: label,
    screenReader: params.has("reader"),
    onStatus(next) {
      status.textContent = `${next.exactLines ? "" : "≈"}Ln ${next.line + 1}, Col ${next.column + 1} · byte ${next.offset} of ${next.size} · tier ${next.tier}${next.selections > 1 ? ` · ${next.selections} carets` : ""}`
    },
  })
  view.focus()
  Object.assign(globalThis, { editor: view, handle })
}

document.querySelector<HTMLInputElement>("#file")!.addEventListener("change", ({ target }) => {
  const file = (target as HTMLInputElement).files?.[0]
  if (file) void open({ kind: "blob", blob: file }, file.name)
})

Object.assign(globalThis, {
  lab: {
    browserFiles,
    openFile,
    testFileProvider,
    memoryFiles,
    newWorker: () => new Worker(new URL("../../src/core/document-worker.ts", import.meta.url), { type: "module" }),
    SaveConflictError,
  },
})

await open(specs[name] ?? specs.sample!, `${name} document`, name === "sample" ? typescriptLexer : undefined)
