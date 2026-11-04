import { serveDocument } from "./worker.ts"

serveDocument(self as unknown as Parameters<typeof serveDocument>[0])
