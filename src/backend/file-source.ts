import type { ByteEdit as FileByteEdit, FileProvider, FileStat, FileUri, WriteBase } from "glass-ux/file-provider"
import { SaveConflictError, type SaveTarget } from "../core/document.ts"
import type { ByteEdit, ByteSource } from "../core/types.ts"

const encoder = new TextEncoder()

/** Reads one version of a file, a range at a time. A later version fails rather than mixing. */
export function fileSource(provider: FileProvider, stat: FileStat): ByteSource {
  return {
    size: stat.size ?? 0,
    read(start, length, signal) {
      return provider.read(stat.uri, { offset: start, length }, { signal: signal ?? new AbortController().signal, version: stat.version })
    },
  }
}

const toFileEdit = ({ start, end, text }: ByteEdit): FileByteEdit => ({
  offset: start,
  deleteLength: end - start,
  insert: typeof text === "string" ? encoder.encode(text) : text,
})

/** The result of saving through {@link fileTarget}. */
export interface FileSaveState {
  /** The version the next save must build on. Updated by each save. */
  stat: FileStat
}

export interface FileTargetOptions {
  signal?: AbortSignal
  /**
   * Replace whatever is there now, after a person chose to. This always writes the whole text: an
   * edit list describes the version that was read, so patching a newer file would corrupt it.
   */
  overwrite?: boolean
}

/**
 * Saves to a file, only if it is still the version that was read. It sends just the edits when the
 * provider can apply them, which is what makes a small change to a huge file cheap, and otherwise
 * streams the whole text. A conflict rejects with `SaveConflictError`, and nothing is written.
 */
export function fileTarget(provider: FileProvider, state: FileSaveState, { signal = new AbortController().signal, overwrite = false }: FileTargetOptions = {}): SaveTarget {
  return {
    async write({ size, edits, stream }) {
      const { uri, version } = state.stat
      const result = provider.applyEdits && !overwrite
        ? await provider.applyEdits(uri, version, edits.map(toFileEdit), { signal })
        : await writeWhole(provider, uri, size, stream, overwrite ? { overwrite: true } : { version }, signal)
      if (result.status === "conflict") {
        throw new SaveConflictError(result.current ? `${uri} changed since it was opened.` : `${uri} no longer exists.`)
      }
      state.stat = result.stat
      return fileSource(provider, result.stat)
    },
  }
}

function writeWhole(provider: FileProvider, uri: FileUri, size: number, stream: () => AsyncIterable<Uint8Array>, base: WriteBase, signal: AbortSignal) {
  if (!provider.write) throw new Error(`${provider.label} is read-only.`)
  return provider.write(uri, toReadable(stream()), { base, size, signal })
}

export function toReadable(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next()
      if (done) controller.close()
      else controller.enqueue(value.slice())
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
