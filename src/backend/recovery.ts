import type { FileUri } from "glass-ux/file-provider"
import type { JournalEntry } from "../core/journal.ts"

/**
 * Keeps each file's journal of unsaved edits where a crash or a closed tab cannot take it. The
 * workbench writes on every change and reads when a file opens. An application can keep journals
 * anywhere: its server, the browser, or nowhere at all.
 */
export interface RecoveryStore {
  /** The journal kept for a file, or null. */
  load(uri: FileUri): Promise<JournalEntry | null>
  /** Keeps a journal, or forgets it when `entry` is null. */
  save(uri: FileUri, entry: JournalEntry | null): Promise<void>
}

/** Journals in memory, which survive a remount but not a reload. For tests and demos. */
export function memoryRecovery(): RecoveryStore {
  const entries = new Map<FileUri, JournalEntry>()
  return {
    load: async (uri) => entries.get(uri) ?? null,
    async save(uri, entry) {
      if (entry) entries.set(uri, entry)
      else entries.delete(uri)
    },
  }
}

const STORE = "journals"

/**
 * Journals in the browser's IndexedDB, under a database `name`, so unsaved edits survive a crash,
 * a closed tab and a reload. Use one name per application, or per signed-in person.
 */
export function browserRecovery(name = "glass-ux-ide.recovery"): RecoveryStore {
  let opening: Promise<IDBDatabase> | null = null
  const database = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }))
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) => {
    const transaction = (await database()).transaction(STORE, mode)
    const request = work(transaction.objectStore(STORE))
    return new Promise<T>((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }
  return {
    load: async (uri) => ((await run("readonly", (store) => store.get(uri))) as JournalEntry | undefined) ?? null,
    async save(uri, entry) {
      await run<unknown>("readwrite", (store) => (entry ? store.put(entry, uri) : store.delete(uri)) as IDBRequest<unknown>)
    },
  }
}

/** Whether this page can keep journals in IndexedDB. */
export const canRecover = () => typeof indexedDB !== "undefined"
