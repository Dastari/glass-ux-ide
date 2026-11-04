# Backends

Everything the workbench does to files and languages goes through interfaces your application
implements. Every part is optional, and the interface reads what is present: without `completion`
there are no provided suggestions, and without `rename` on a provider there is no rename.

Transport, authentication and security belong to the application. A provider arrives already able
to do its job.

## Files

Files come from any glass-ux `FileProvider`. Only `stat` and `read` are required, and every other
capability adds a command. In the browser, with no backend at all:

| Source | Use |
| --- | --- |
| `memoryFiles` from `glass-ux/file-provider/memory` | Files held in memory |
| `browserFiles` | The browser's private file system |
| `folderFiles` | A folder a person picks, where `canPickFolder()` is true |
| `httpFiles` | Read-only files from any server with range requests |

With more than one provider, each is a top-level folder in the explorer.

## Language features

```ts
import type { IdeBackend } from "glass-ux-ide/backend"

const backend: IdeBackend = {
  files: [project],
  completion: {
    triggerCharacters: ["."],
    async provideCompletions(document, position, context, signal) {
      const line = await document.line(position.line)
      return askYourLanguageService(line, position, signal)
    },
  },
  diagnostics: {
    subscribe(uri, report) {
      return yourService.onDiagnostics(uri, report)
    },
  },
}
```

The shapes follow the Language Server Protocol's concepts, so a language server adapts in a few
lines. `DocumentReader` reads a document without forcing all of it into a string.

Hover, go to definition and rename take the same reader and position:

```ts
const backend: IdeBackend = {
  files: [project],
  hover: { provideHover: (document, position, signal) => service.hover(document.uri, position, signal) },
  definition: { provideDefinition: (document, position, signal) => service.definition(document.uri, position, signal) },
  rename: {
    prepareRename: (document, position, signal) => service.prepareRename(document.uri, position, signal),
    provideRenameEdits: (document, position, newName, signal) => service.rename(document.uri, position, newName, signal),
  },
  documents: {
    opened: (document) => service.open(document),
    changed: (uri, version, edits) => service.change(uri, version, edits),
    closed: (uri) => service.close(uri),
  },
}
```

A hover shows while the pointer rests on text, or with Ctrl K Ctrl I at the caret. F12, or Ctrl and a
click, goes to the first definition. F2 renames across every file the edit names, as one undo step in
each. `documents` receives files up to 5 MB: the text when one opens, then one edit per change.

## Formatting

Format document (Shift Alt F) uses `backend.format` when there is one. Without it, the built-in
formatter in `glass-ux-ide/format` re-indents TypeScript, JavaScript, JSX, JSON and CSS by their
brackets, removes trailing spaces and keeps one blank line in a row. It never reflows a line, so it is
safe on any file its lexer reads. `formatText(text, languageOf(uri))` runs it anywhere.

## Unsaved edits

The workbench journals every change to an open file, and keeps the journal in the browser's IndexedDB
by default. After a crash, a reload or a closed tab, opening the file offers its unsaved edits back,
with the same undo steps. The journal holds operations, not text, so a keystroke in a huge file costs a
few bytes. Give `recovery` any `RecoveryStore` to keep journals elsewhere, or `null` to keep none.

```tsx
<Workbench backend={backend} recovery={browserRecovery(`my-app.${userId}`)} />
```

## Search

The Search view uses `backend.search` when there is one. Without it, `browserSearch` reads each file
of up to 2 MiB through its provider, in the page. An application with a large project implements
`SearchProvider` beside its data.

```ts
const backend = {
  files: [project],
  search: {
    async search(query, report, signal) {
      for await (const result of yourIndex.find(query, signal)) report(result)
    },
  },
}
```

## Your own views and panels

Anything specific to your product, such as a terminal or source control, is a view in the rail or a
panel beside Problems and Output.

```tsx
<Workbench
  backend={backend}
  views={[{ id: "deployments", label: "Deployments", icon: <IconCloud />, content: <DeploymentsView /> }]}
  panels={[{ id: "terminal", title: "Terminal", component: Terminal, keepRunning: true }]}
/>
```

A view's content is a `SectionDrawer.Root` and its parts. `useWorkbench` gives views and panels the
workbench's operations.
