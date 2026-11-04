/** A fictional service's source, in memory. Nothing here is a real project, host or person. */
const QUEUE = `import { backoff, type RetryPolicy } from "./policy"
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
    return this.journal.size
  }
}
`

export const SOURCES: Record<string, string> = {
  "src/sync/replica-queue.ts": QUEUE,
  "src/sync/policy.ts": `export interface RetryPolicy {
  attempts: number
  baseMs: number
}

/** Waits longer after each failed attempt. */
export function backoff(policy: RetryPolicy, attempt: number) {
  const delay = policy.baseMs * 2 ** attempt
  return new Promise((resolve) => setTimeout(resolve, delay))
}
`,
  "src/sync/types.ts": `export interface Replica {
  id: string
  send(event: ReplicaEvent): Promise<boolean>
}

export interface ReplicaEvent {
  kind: "upsert" | "remove"
  key: string
  at: number
}
`,
  "src/sync/replica-queue.test.ts": `import { describe, expect, it } from "vitest"
import { ReplicaQueue } from "./replica-queue"

describe("ReplicaQueue", () => {
  it("delivers events in order", async () => {
    const seen: string[] = []
    expect(seen).toEqual([])
  })
})
`,
  "src/storage/journal.ts": `/** Append-only storage for events that have not been delivered. */
export class Journal {
  /* Offsets are bytes,
     from the start of the segment. */
  private offset = 0

  get size() {
    return this.offset
  }

  async append(id: string, event: unknown) {
    this.offset += JSON.stringify({ id, event }).length
    return this.offset
  }
}
`,
  "src/storage/segment.ts": `export const SEGMENT_BYTES = 64 * 1024 * 1024
`,
  "src/server.ts": `import { ReplicaQueue } from "./sync/replica-queue"

const port = Number(process.env.PORT ?? 8080)
console.log(\`listening on \${port}\`)
`,
  "package.json": `{
  "name": "harbour-api",
  "version": "1.4.0",
  "type": "module"
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "strict": true
  }
}
`,
  "web/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Harbour status</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- Filled in by the status page's script. -->
    <main id="status" data-replicas="3">Loading…</main>
  </body>
</html>
`,
  "web/styles.css": `:root {
  --gap: 0.75rem;
}

#status {
  display: grid;
  gap: var(--gap);
  color: #1f7ae0;
}
`,
  "README.md": `# harbour-api

Delivers replica events in order.

日本語のテキストと 🙂 絵文字 also work here.
`,
}
