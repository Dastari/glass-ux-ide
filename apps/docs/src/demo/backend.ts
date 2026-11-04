/**
 * A fictional language service, the size of a demo: it keeps its own copy of each file through
 * `documents`, and answers from that. A real application connects a language server here instead.
 */
import type { FileProvider, FileUri } from "glass-ux/file-provider";
import type { CompletionItem, Diagnostic, IdeBackend, Location, TextEdit, TextRange } from "glass-ux-ide/backend";

const MEMBERS: CompletionItem[] = [
  { label: "append", kind: "method", detail: "(id: string, event: ReplicaEvent) => Promise<void>" },
  { label: "checkpoint", kind: "method", detail: "() => Promise<Offset>" },
  { label: "compact", kind: "method", detail: "(before: Offset) => Promise<number>" },
  { label: "flushed", kind: "field", detail: "Offset" },
  { label: "replay", kind: "method", detail: "(from?: Offset) => AsyncIterable<ReplicaEvent>" },
  { label: "size", kind: "field", detail: "number" },
];

const DOCS: Record<string, string> = {
  ReplicaQueue: "class ReplicaQueue\nDelivers replica events in order and retries the ones that fail.",
  Journal: "class Journal\nAppend-only storage for events that have not been delivered.",
  backoff: "function backoff(policy: RetryPolicy, attempt: number): Promise<unknown>\nWaits longer after each failed attempt.",
  RetryPolicy: "interface RetryPolicy\n  attempts: number\n  baseMs: number",
  Replica: "interface Replica\n  id: string\n  send(event: ReplicaEvent): Promise<boolean>",
  ReplicaEvent: 'interface ReplicaEvent\n  kind: "upsert" | "remove"\n  key: string\n  at: number',
  enqueue: "(method) ReplicaQueue.enqueue(replica: Replica, event: ReplicaEvent): Promise<void>\nQueues an event and starts a flush when none is running.",
  flushing: "(property) ReplicaQueue.flushing: boolean",
};

const WORD = /[A-Za-z_$][\w$]*/g;
const offsetOf = (text: string, { line, column }: { line: number; column: number }) => {
  let at = 0;
  for (let index = 0; index < line; index += 1) at = text.indexOf("\n", at) + 1;
  return at + column;
};
const positionOf = (text: string, offset: number) => {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) };
};
const wordAt = (text: string, offset: number) => {
  for (const match of text.matchAll(WORD)) if (match.index <= offset && offset <= match.index + match[0].length) return { word: match[0], start: match.index };
  return null;
};

export function demoBackend(files: readonly FileProvider[], project: FileProvider): IdeBackend & { files: readonly FileProvider[] } {
  const texts = new Map<FileUri, string>();
  const listeners = new Map<FileUri, (diagnostics: readonly Diagnostic[]) => void>();
  const signal = new AbortController().signal;

  const check = (uri: FileUri) => {
    const text = texts.get(uri);
    const report = listeners.get(uri);
    if (text === undefined || !report) return;
    const found: Diagnostic[] = [];
    for (const match of text.matchAll(/flushing = false/g)) {
      const start = positionOf(text, match.index);
      found.push({ severity: "warning", source: "demo", message: "'flushing' is shared by every replica.", range: { start, end: { line: start.line, column: start.column + 8 } } });
    }
    report(found);
  };

  /** Every project file's text: the open copy where there is one, else the file. */
  const everyText = async () => {
    const list = await project.readDirectory!(project.root ?? "project:///", { signal });
    const walk = async (entries: typeof list.entries): Promise<[FileUri, string][]> =>
      (await Promise.all(entries.map(async (entry) => {
        if (entry.kind === "directory") return walk((await project.readDirectory!(entry.uri, { signal })).entries);
        const held = texts.get(entry.uri);
        if (held !== undefined) return [[entry.uri, held] as [FileUri, string]];
        const bytes = await project.read(entry.uri, { offset: 0, length: entry.size ?? 0 }, { signal });
        return [[entry.uri, new TextDecoder().decode(bytes)] as [FileUri, string]];
      }))).flat();
    return walk(list.entries);
  };

  const rangeOf = (text: string, start: number, length: number): TextRange => ({ start: positionOf(text, start), end: positionOf(text, start + length) });

  return {
    files,
    documents: {
      opened({ uri, text }) {
        texts.set(uri, text);
        check(uri);
      },
      changed(uri, _version, edits) {
        let text = texts.get(uri) ?? "";
        for (const { range, text: inserted } of edits) text = text.slice(0, offsetOf(text, range.start)) + inserted + text.slice(offsetOf(text, range.end));
        texts.set(uri, text);
        check(uri);
      },
      closed(uri) {
        texts.delete(uri);
      },
    },
    completion: {
      triggerCharacters: ["."],
      async provideCompletions(_document, _position, _context, abort) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        abort.throwIfAborted();
        return MEMBERS;
      },
    },
    diagnostics: {
      subscribe(uri, report) {
        listeners.set(uri, report);
        check(uri);
        return () => listeners.delete(uri);
      },
    },
    hover: {
      async provideHover(document, position) {
        const line = await document.line(position.line);
        const found = wordAt(line, position.column);
        const contents = found && DOCS[found.word];
        return contents ? { contents, range: { start: { line: position.line, column: found.start }, end: { line: position.line, column: found.start + found.word.length } } } : null;
      },
    },
    definition: {
      async provideDefinition(document, position) {
        const found = wordAt(await document.line(position.line), position.column);
        if (!found) return [];
        const declaration = new RegExp(`\\b(?:class|interface|function|const|let|type)\\s+${found.word}\\b|\\b(?:async\\s+)?${found.word}\\s*\\(.*\\)\\s*\\{|\\bprivate\\s+(?:readonly\\s+)?${found.word}\\b`);
        const locations: Location[] = [];
        for (const [uri, text] of await everyText()) {
          const match = declaration.exec(text);
          if (!match) continue;
          const start = match.index + match[0].indexOf(found.word);
          locations.push({ uri, range: rangeOf(text, start, found.word.length) });
        }
        return locations;
      },
    },
    rename: {
      async prepareRename(document, position) {
        const found = wordAt(await document.line(position.line), position.column);
        return found ? { placeholder: found.word, range: { start: { line: position.line, column: found.start }, end: { line: position.line, column: found.start + found.word.length } } } : null;
      },
      async provideRenameEdits(document, position, newName) {
        const found = wordAt(await document.line(position.line), position.column);
        if (!found) return { changes: {} };
        const changes: Record<FileUri, TextEdit[]> = {};
        for (const [uri, text] of await everyText()) {
          const edits = [...text.matchAll(new RegExp(`\\b${found.word}\\b`, "g"))].map((match) => ({ range: rangeOf(text, match.index, found.word.length), text: newName }));
          if (edits.length) changes[uri] = edits;
        }
        return { changes };
      },
    },
  };
}
