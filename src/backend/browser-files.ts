/**
 * Files that need no server: the browser's own private storage, a folder the person grants, and
 * read-only HTTP. Each is a `FileProvider`, the same contract an application's backend implements.
 */
import type { DirectoryPage, FileEntry, FileProvider, FileProviderError, FileStat, FileUri, WriteOptions, WriteResult } from "glass-ux/file-provider"

const providerError = (code: FileProviderError["code"], message: string): FileProviderError => Object.assign(new Error(message), { code })

const segments = (uri: FileUri) => uri.replace(/^[a-z0-9+.-]+:\/*/i, "").split("/").filter(Boolean).map(decodeURIComponent)

const versionOf = (file: File) => `${file.size}:${file.lastModified}`

/** A provider over a directory handle: the private file system, or a folder the person chose. */
function directoryFiles(scheme: string, label: string, root: () => Promise<FileSystemDirectoryHandle>): FileProvider {
  const uriOf = (path: readonly string[]) => `${scheme}:///${path.map(encodeURIComponent).join("/")}`

  const folder = async (path: readonly string[], create = false) => {
    let handle = await root()
    for (const name of path) {
      try {
        handle = await handle.getDirectoryHandle(name, { create })
      } catch {
        throw providerError("not-found", `${name} does not exist.`)
      }
    }
    return handle
  }

  const fileHandle = async (uri: FileUri, create = false) => {
    const path = segments(uri)
    const name = path.pop()
    if (!name) throw providerError("not-found", "That is a folder.")
    const parent = await folder(path, create)
    try {
      return await parent.getFileHandle(name, { create })
    } catch {
      throw providerError("not-found", `${name} does not exist.`)
    }
  }

  const statOf = async (handle: FileSystemHandle, path: readonly string[]): Promise<FileStat> => {
    if (handle.kind === "directory") return { uri: uriOf(path), name: handle.name, kind: "directory", size: null, version: "directory" }
    const file = await (handle as FileSystemFileHandle).getFile()
    return { uri: uriOf(path), name: handle.name, kind: "file", size: file.size, version: versionOf(file), modified: file.lastModified }
  }

  const store = async (uri: FileUri, source: ReadableStream<Uint8Array>, { base, onProgress, signal }: WriteOptions): Promise<WriteResult> => {
    signal.throwIfAborted()
    const current = await provider.stat(uri, { signal }).catch(() => null)
    if ("version" in base && current?.version !== base.version) return { status: "conflict", current }
    if ("absent" in base && current) return { status: "conflict", current }
    const handle = await fileHandle(uri, true)
    const writable = await handle.createWritable()
    let written = 0
    const reader = source.getReader()
    try {
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        signal.throwIfAborted()
        await writable.write(next.value as BufferSource)
        written += next.value.length
        onProgress?.(written)
      }
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => undefined)
      throw error
    }
    return { status: "written", stat: await provider.stat(uri, { signal }) }
  }

  const provider: FileProvider = {
    scheme,
    label,
    async stat(uri, { signal }) {
      signal.throwIfAborted()
      const path = segments(uri)
      if (path.length === 0) return statOf(await root(), [])
      const name = path[path.length - 1]!
      const parent = await folder(path.slice(0, -1))
      const handle = await parent.getFileHandle(name).catch(() => parent.getDirectoryHandle(name)).catch(() => {
        throw providerError("not-found", `${name} does not exist.`)
      })
      return statOf(handle, path)
    },
    async read(uri, { offset, length }, { signal, version }) {
      signal.throwIfAborted()
      const file = await (await fileHandle(uri)).getFile()
      if (version && versionOf(file) !== version) throw providerError("changed", `${file.name} changed.`)
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
    },
    async readDirectory(uri, { signal }): Promise<DirectoryPage> {
      signal.throwIfAborted()
      const path = segments(uri)
      const entries: FileEntry[] = []
      const iterable = (await folder(path)) as unknown as { values(): AsyncIterable<FileSystemHandle> }
      for await (const handle of iterable.values()) entries.push(await statOf(handle, [...path, handle.name]))
      entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name))
      return { entries, cursor: null, total: entries.length }
    },
    write: store,
    async createDirectory(uri, { signal }) {
      signal.throwIfAborted()
      const path = segments(uri)
      await folder(path, true)
      return statOf(await folder(path), path)
    },
    async delete(uri, { signal }) {
      signal.throwIfAborted()
      const path = segments(uri)
      const name = path.pop()
      if (!name) throw providerError("denied", "The root cannot be deleted.")
      await (await folder(path)).removeEntry(name, { recursive: true }).catch(() => {
        throw providerError("not-found", `${name} does not exist.`)
      })
    },
  }
  return provider
}

/** Files kept in this browser. They survive a reload, and need no permission or server. */
export function browserFiles({ scheme = "browser", label = "This browser", folder = "glass-ux-ide" } = {}): FileProvider {
  return directoryFiles(scheme, label, async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true }))
}

/** Files in a folder the person chose. `showDirectoryPicker` is Chromium-only. */
export function folderFiles(handle: FileSystemDirectoryHandle, { scheme = "folder", label = handle.name } = {}): FileProvider {
  return directoryFiles(scheme, label, async () => handle)
}

/** Whether this browser can ask for a folder. */
export const canPickFolder = () => "showDirectoryPicker" in globalThis

/** Read-only files over HTTP, using range requests. The server must allow them, and CORS. */
export function httpFiles({ scheme = "http-files", label, baseUrl }: { scheme?: string; label: string; baseUrl: string }): FileProvider {
  const urlOf = (uri: FileUri) => new URL(segments(uri).map(encodeURIComponent).join("/"), baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href
  const failed = (status: number, uri: FileUri) => providerError(status === 404 ? "not-found" : status === 403 ? "denied" : "unavailable", `${uri}: the server answered ${status}.`)
  const versionFrom = (headers: Headers) => headers.get("etag") ?? `${headers.get("content-length")}:${headers.get("last-modified")}`
  return {
    scheme,
    label,
    async stat(uri, { signal }) {
      const response = await fetch(urlOf(uri), { method: "HEAD", signal })
      if (!response.ok) throw failed(response.status, uri)
      const length = response.headers.get("content-length")
      return { uri, name: decodeURIComponent(uri.split("/").pop() ?? ""), kind: "file", size: length ? Number(length) : null, version: versionFrom(response.headers) }
    },
    async read(uri, { offset, length }, { signal, version }) {
      const headers: Record<string, string> = { range: `bytes=${offset}-${offset + length - 1}` }
      if (version) headers["if-match"] = version
      const response = await fetch(urlOf(uri), { headers, signal })
      if (response.status === 412) throw providerError("changed", `${uri} changed.`)
      if (response.status === 416) return new Uint8Array(0)
      if (!response.ok) throw failed(response.status, uri)
      if (response.status === 200) {
        // The server ignored the range: fine for a small file, ruinous for a large one.
        const bytes = new Uint8Array(await response.arrayBuffer())
        return bytes.subarray(offset, offset + length)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
