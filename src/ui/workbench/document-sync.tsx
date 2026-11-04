import { useEffect } from "react"
import type { FileUri } from "glass-ux/file-provider"
import type { DocumentSync } from "../../backend/language.ts"
import { tierOf } from "../../core/tiers.ts"
import { languageOf } from "../../format/index.ts"
import { editBetween } from "./language.ts"
import type { WorkbenchStore } from "./store.ts"

/**
 * Keeps a backend's copy of each open file up to date, for a language server: the text when a file
 * opens, then the one edit between each version and the next. Files over 5 MB are not sent.
 */
export function DocumentSyncBridge({ store, sync }: { store: WorkbenchStore; sync: DocumentSync }) {
  useEffect(() => {
    const sent = new Map<FileUri, { text: string; version: number; at: number }>()
    const pending = new Map<FileUri, Promise<void>>()
    const follow = (uri: FileUri) => {
      const run = (pending.get(uri) ?? Promise.resolve()).then(async () => {
        const record = store.get(uri)
        if (!record) return
        const held = sent.get(uri)
        if (held && held.at === record.version) return
        const { handle } = record.opened
        const state = await handle.state()
        if (tierOf(state.size) > 0) return
        const text = await handle.text(0, state.size)
        if (!held) {
          sent.set(uri, { text, version: 1, at: record.version })
          sync.opened({ uri, language: languageOf(uri), version: 1, text })
          return
        }
        const edit = editBetween(held.text, text)
        sent.set(uri, { text, version: held.version + 1, at: record.version })
        if (edit) sync.changed(uri, held.version + 1, [edit])
      }).catch(() => undefined)
      pending.set(uri, run)
    }
    const check = () => {
      const open = new Set(store.getSnapshot().map((record) => record.uri))
      for (const uri of open) follow(uri)
      for (const uri of sent.keys()) {
        if (open.has(uri)) continue
        sent.delete(uri)
        sync.closed(uri)
      }
    }
    check()
    const stop = store.subscribe(check)
    return () => {
      stop()
      for (const uri of sent.keys()) sync.closed(uri)
    }
  }, [store, sync])
  return null
}
