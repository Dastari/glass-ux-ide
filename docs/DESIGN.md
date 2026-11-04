# Glass UX IDE: design

Status: 4 November 2026, version 0.1.0, on glass-ux 0.15.0. Built: the text engine, undo across
saves, crash recovery, `EditorView`, `CodeEditor`, `CodeViewer`, `CodeField`, the `Workbench` and
each of its parts, code windows, project search, comparing with saved, hover, go to definition,
rename, document sync, a built-in formatter, five languages, browser file providers, 11 language
packs, and generated API docs. Section 20 says what remains, and [performance.md](performance.md)
has the measurements. The mock-ups in `mockups/` are drawings made from real glass-ux 0.13.0
components; their editor surface is not the engine described below.

## 1. Summary

Glass UX IDE is a **component library**. It gives an application a fast code editor, the pieces
around it, and interfaces for connecting them to the application's own backend. Someone can use
one `CodeField` in a form, or assemble a full IDE on top of their server.

The library ships no server, agent or daemon. It works in the browser for everything that needs
no backend, and defines the interfaces for everything that does.

Four decisions shape the design:

1. **The document never lives on the main thread or in one string.** A worker owns the text as a
   piece tree over bytes, so file size stops mattering to the UI.
2. **One code path at every size.** Size only changes which background features run.
3. **The editor surface is plain DOM written without React:** a small recycled pool of rows on an
   opaque surface, keeping bidirectional text, IME, screen readers and CSS theming.
4. **Backends are interfaces, and every one is optional.** Anything an application does not
   provide simply does not appear.

## 2. Scope

### What runs where

| Feature | In the browser alone | With the application's backend |
| --- | --- | --- |
| Editing, undo, history, huge files | Built in | Nothing needed |
| Syntax highlighting | Built in | Nothing needed |
| Files | Memory, browser storage, local folder, HTTP read | Any store, through `FileSystemProvider` |
| Saving a huge file | Rewrites the file | Sends only the edits, through `applyEdits` |
| Search | Open documents and browser files | Whole project, through `SearchProvider` |
| Formatting | Optional built-in formatter | `FormatProvider` |
| Autocomplete | Words in open files, snippets | `CompletionProvider` |
| Problems | Syntax errors | `DiagnosticsProvider` |
| Hover, go to definition, rename | None | Language providers |
| Terminal, Git, debugging | None | The application's own views, added to the workbench |

### What the library is not responsible for

- **Security.** Authentication, permissions, secrets, encryption and transport are the
  application's. The library has no auth API and stores no credentials. A provider arrives already
  able to do its job.
- **Servers and language tooling.** No agent, language servers, type checker, SSH or cloud storage
  clients. The application can run all of these and connect them through the interfaces.
- **Terminal, Git and debugger views.** An application adds its own through the same view
  contribution API the built-in views use.

### Third-party code

No third-party runtime imports except glass-ux and its peer, React. Dev tooling (TypeScript, Vite,
Vitest, Playwright, TypeDoc) is not shipped. Prettier may be used in development to measure the
built-in formatter, and is never a runtime dependency.

## 3. Architecture

```
┌─ Application ──────────────────────────────────────────────────────────────┐
│  glass-ux-ide/workbench   Workbench, EditorGroup, StatusBar                │
│  glass-ux-ide/views/*     Explorer, Search, Problems, Outline, History     │
│  glass-ux-ide/editor      CodeEditor, CodeField, CodeViewer, CodeDiff      │
│  glass-ux-ide/react       Hooks                                            │
├─ Main thread, no React in the hot path ────────────────────────────────────┤
│  EditorView: row pool, caret, selection, input, viewport cache             │
│  Application providers (see "Providers and the worker")                    │
├─ postMessage, transferred buffers ─────────────────────────────────────────┤
│  Document worker: piece tree, line index, undo, journal, search            │
│  Language worker: lexers, optional parsers and formatter                   │
├─ IdeBackend: every part optional ──────────────────────────────────────────┤
│  Built in: memory · opfs · local · http         Yours: anything            │
└────────────────────────────────────────────────────────────────────────────┘
```

Each layer may import only the ones below it, enforced by `pnpm boundaries:check`:

| Layer | May use | Purpose |
| --- | --- | --- |
| `core/` | Web standards only; no DOM | Buffer, history, search, lexer engine. Runs in a worker or Node. |
| `languages/` | `core` | One folder per language. |
| `view/` | `core`, DOM | `EditorView`: usable from any framework. |
| `react/` | `view`, React | Hooks and thin wrappers. |
| `ui/` | `react`, glass-ux | Components. |

SharedArrayBuffer is not required. It needs COOP and COEP headers, which many applications cannot
set and GitHub Pages cannot send.

## 4. Text engine

### Buffer

The document is a **persistent AVL tree of pieces**, built on `join`, so an edit is two splits and a
join. A piece is a range of bytes in either the original file or an append-only add buffer. Each
node stores its subtree's byte and line-feed counts. A piece of the original file does not know its
line-feed count until the index reaches it, so the tree also tracks bytes of unknown line count.

- **Edits** are O(log p), where p is the number of pieces. That grows with the number of edits,
  never the file size.
- **Snapshots** are O(1), because an edit copies only the path it changes. Search, save and undo
  read an immutable snapshot, so none of them block typing.
- **Offsets** are doubles. Nothing does 32-bit bit operations on an offset, or files past 4 GB
  fail silently.

Original bytes are read through the provider into an LRU of 64 KiB pages, with a 128 MB default
budget. The add buffer is 1 MiB chunks that spill to the Origin Private File System (OPFS) under
pressure.

V8 caps a string at about 512 MiB, so the whole document must never become a string. `getText()`
on a big range is deliberately not in the API; it offers a stream instead.

### Line index

A worker scans with `Uint8Array.indexOf` and records a cumulative line-feed count every 256 KiB of
file. Memory depends only on file size, about 1.5 MB for 48 GB, so one enormous line costs the same
as any other file. Until indexing finishes the file is already usable: byte offsets are exact, and
line numbers are estimates shown with `≈`, corrected when the index completes.

On a slow remote source, full indexing may be unreasonable. A provider can supply a line count or
a prebuilt index; otherwise the engine indexes only the regions that have been read.

### Positions and encodings

Internally a position is a byte offset. The public API uses `{ line, column }` in UTF-16 code
units, as the DOM and LSP do, and converts on demand.

Bytes stay in the file's own encoding, so unedited regions round-trip exactly. Decoding uses the
built-in `TextDecoder` a page at a time. `TextEncoder` only writes UTF-8, so UTF-16 is hand-written
and legacy encodings use tables generated at build time. A mixed line-ending file is reported
rather than normalised.

### Hostile files

Long lines kill most editors, so they are handled at every size. The engine breaks a line longer
than a row limit into several rows at character boundaries, so a 2 GB single-line minified JSON
file can never become one enormous string or DOM node. Columns are counted from the bytes, for the
same reason. Binary files open read-only as hex. Monospaced fonts only in the first release.

## 5. Size tiers

The tier is a budget for background work, and a person can raise it for one file. Editing, undo,
search and saving behave identically at all four.

| Tier | Size | Highlighting | Folding, outline | Backend providers | Minimap |
| --- | --- | --- | --- | --- | --- |
| 0 | Under 5 MB | Full | Syntax, where a parser exists | Yes | Code |
| 1 | 5–64 MB | Full, incremental | Syntax, where a parser exists | Yes | Code |
| 2 | 64 MB–2 GB | Lexer, in the background | Indentation | Range-based only | Sampled |
| 3 | Over 2 GB | Lexer, visible lines | Off | Range-based only | Density |

A provider declares whether it needs the whole document or can work from ranges. Whole-document
providers stop at tier 2, because they would need the text as one string. The status bar names
the tier, and the Document view lists what is off and why.

Budgets are shared across open documents, so ten large tabs cannot add up to an out-of-memory
crash. The defaults are 512 MB for the workers and 50 MB for the main thread, and applications can
change them with `budget`.

## 6. Rendering

`EditorView` keeps a pool of absolutely positioned rows, about the viewport height plus 10. It
writes them directly from a `requestAnimationFrame` batch and patches only rows whose content hash
changed. React mounts the view and never touches a row (R18.5).

- **Rows** are `contain: strict` with one span per token. Colour comes from CSS variables, so a
  palette or mode change costs no re-render.
- **Caret, selection and decorations** sit in separate overlay layers. The caret moves by
  transform only.
- **The surface is opaque.** `Surface glass="solid"` means nothing behind scrolling text ever
  re-blurs, which glass-ux's `docs/performance.md` identifies as the main compositor cost.
- **The minimap** paints on an `OffscreenCanvas` in the language worker. At tier 3 it shows sampled
  density and search hits, never text.
- **Scrolling** uses a native scroller capped at 8 million CSS pixels. Above that, position maps to
  bytes, a small movement counts rows from an anchor, and only a large one jumps. The bar settles
  when scrolling stops and stays off both ends unless the text is really there, because one pixel
  can be 100 lines. This keeps native momentum and passive listeners.

**Why not canvas or WebGL?** Virtualised rows cost the same at any file size, so canvas does not
help huge files; the buffer does that. Canvas would mean rebuilding bidirectional text, IME
placement and screen reader output. The Phase 2 gate settled this: DOM rows hold 60 fps on a real
20 GB file, so there is no canvas renderer.

## 7. Input

Text enters through a hidden `textarea` at the caret, giving IME, dictation and mobile keyboards a
real target. EditContext is used where it exists, but MDN does not list it as Baseline, so the
textarea is the tested path.

**The keystroke path never waits for the worker.** The main thread applies a printable character
to its cached line and paints in the same frame, then posts the operation. Only one view writes at
a time, so no merge logic is needed.

**Commands run in order.** Keys arrive faster than an async caret move finishes, so commands queue,
and a command starts in the same event when the queue is empty, which keeps typing synchronous.
Rows read before an edit landed are dropped, or the typed character would flicker away.

Copying 10 GB into a string cannot work, so above 256 MB the copy is refused with the reason, and
**Save selection as file** streams it instead.

## 8. Undo, history and saving

| Layer | Holds | Lifetime | Stored in |
| --- | --- | --- | --- |
| Undo tree | Snapshot roots and selections, grouped by typing bursts | Open document | Memory, sharing structure |
| Journal | Every edit, append-only | Until saved and closed | OPFS, or off with `journal={false}` |
| Local history | Saves, formats and external changes | Configurable count and size | OPFS, or `HistoryStore` |

- **Undo never discards.** Typing after an undo starts a branch, and the old branch stays on the
  timeline.
- **Crash recovery.** The journal flushes about once a second. On reopening, if the file's size,
  version and sampled hash still match the journal's base, unsaved work is restored.
- **Bulk changes stay bounded.** Replace-all above 100,000 matches streams into a spill file and
  becomes a single piece.
- **Applications can own storage.** `HistoryStore` keeps history in the application's backend.

### Saving

A save works from a snapshot, in the background, so typing continues through it. If the write fails
or conflicts, nothing is lost. There are two paths, chosen by what the provider offers:

| Provider offers | What happens | Cost of a one-byte edit to 48 GB |
| --- | --- | --- |
| `write` | Streams the whole document | 48 GB written |
| `applyEdits` | Sends the edit list; the backend applies it | A few bytes sent |

**Saving invalidates undo unless handled.** Old pieces point at bytes in the file being replaced.
A provider's write is one atomic step, so before it starts, bytes that exist only in history are
copied into the add buffer. When it finishes, surviving ranges are mapped to their new positions,
including in anything typed during the write. If that exceeds a limit, the save stops with
`HistoryTooLargeError`, so the person can choose to save anyway and lose undo past this point.
A snapshot from before a save then refuses to read, rather than returning the wrong bytes.

A file changed elsewhere is never overwritten silently. The provider answers `conflict` because
`version` differs, the save is held, edits stay in the tab, and the person chooses to overwrite or
reload.

## 9. Backend interfaces

This section is the core of the library's contract with applications.

```ts
interface IdeBackend {
  files?: readonly FileSystemProvider[]
  search?: SearchProvider
  documents?: DocumentSync
  completion?: CompletionProvider
  diagnostics?: DiagnosticsProvider
  format?: FormatProvider
  hover?: HoverProvider
  definition?: DefinitionProvider
  references?: ReferencesProvider
  rename?: RenameProvider
  codeActions?: CodeActionProvider
  history?: HistoryStore
}
```

Every member is optional. The UI reads what is present: without `rename`, the command does not
exist (R12.3). `useBackend()` exposes the same information.

### Files

Files use `FileProvider` from `glass-ux/file-provider`, the contract shared across sister packages.
It is types only, so it is safe in a worker. Only `scheme`, `label`, `stat` and `read` are required.
Every other method is optional, an absent method means the command does not exist, and the UI
adapts with no flags.

```ts
interface FileProvider {
  readonly scheme: string
  readonly label: string
  stat(uri, options): Promise<FileStat> // includes size and version
  read(uri, range, options): Promise<Uint8Array> // pin `version` so pages never mix
  readDirectory?(uri, options): Promise<DirectoryPage>
  write?(uri, source, options): Promise<WriteResult>
  applyEdits?(uri, base, edits, options): Promise<WriteResult>
  // thumbnail, watch, createDirectory, rename, delete
}
```

Writes take a `WriteBase`: `{ version }` to write only if unchanged, `{ absent: true }` to create, or
`{ overwrite: true }`. There is no default, so a blind overwrite is always explicit. A conflict is a
`WriteResult`, not a thrown error.

Ranged `read` is what makes a remote 48 GB file usable: the engine asks only for the pages on
screen. `applyEdits` is what makes saving it cheap. An overwrite never uses it, because an edit list
describes the version that was read, and patching a newer file would corrupt that file.

| Provider | From | Reads | Writes | Notes |
| --- | --- | --- | --- | --- |
| `memoryFiles()` | `glass-ux/file-provider/memory` | Yes | Yes | Tests, demos. |
| `browserFiles()` | `glass-ux-ide/backend` | Any size | Yes | OPFS. Survives reloads. Passes `testFileProvider`. |
| `folderFiles(handle)` | `glass-ux-ide/backend` | Any size | Yes | A folder the person chose. `showDirectoryPicker` is Chromium-only. |
| `httpFiles()` | `glass-ux-ide/backend` | Range requests | No | Read-only. Needs CORS. |

### Language features

Providers use LSP's concepts: positions, ranges, completion kinds, text edits. An application with
a language server adapts it in a few lines, and one without can return whatever it likes.

```ts
interface CompletionProvider {
  /** Characters that open the list, beyond typing an identifier. */
  readonly triggerCharacters?: readonly string[]
  provideCompletions(
    document: DocumentReader,
    position: Position,
    context: CompletionContext,
    signal: AbortSignal,
  ): Promise<CompletionList>
  resolve?(item: CompletionItem, signal: AbortSignal): Promise<CompletionItem>
}
```

`DocumentReader` reads ranges from a snapshot, so a provider never forces the whole document into a
string. A superseded request is aborted through `signal`, and late results are dropped.

Backends that hold their own copy of the text, as language servers do, implement `DocumentSync`:

```ts
interface DocumentSync {
  opened(document: OpenedDocument): void // includes the text, tiers 0 and 1 only
  changed(uri: Uri, version: number, edits: readonly TextEdit[]): void
  closed(uri: Uri): void
}
```

Diagnostics are pushed: `diagnostics.subscribe(uri, report)`. Completion merges the provider's
results with built-in words and snippets, and slow results never move the list under the pointer
(R9).

### Providers and the worker

The document worker needs to read files, but a provider is an object of closures that cannot cross
into a worker. So providers stay on the main thread, and the worker's reads and saves proxy through
it, with the saved text pulled a chunk at a time. Built-in byte and blob sources run in the worker
directly. Typing and scrolling never wait on a read beyond the cached viewport.

### API tools

`testFileProvider` from `glass-ux/testing` is the conformance suite for a file adapter.
A wire protocol helper (`createRpcBackend`) and a language-side conformance suite are not built.

## 10. Languages

Languages are lazy-loaded parts, and everything beyond the lexer is optional:

```ts
defineLanguage({
  id: "typescript",
  extensions: [".ts", ".tsx"],
  lexer: () => import("./lexer"),
  parser: () => import("./parser"), // optional
  formatter: () => import("./printer"), // optional
})
```

| Layer | What it does | Status |
| --- | --- | --- |
| **Lexer** | Declarative rules compiled to tables. Restartable, so highlighting can start anywhere. | Every language |
| **Parser** | Error-tolerant, incremental, lossless tree. Gives syntax errors, folding and outline. | Only where a formatter needs one |
| **Formatter** | Optional, client-side. Tree to document to text, with Prettier's line-fitting algorithm, reading `.prettierrc` options. | JSON, CSS, Markdown, then TypeScript |

**First lexers:** TypeScript and JavaScript with JSX, JSON, CSS, HTML, Markdown, YAML, GraphQL, SQL,
Rust, shell. An application can register its own with `defineLanguage`.

**The formatter is a separate entry,** `glass-ux-ide/format/*`, so an application that does not
import it pays nothing. Its output will closely match Prettier, not exactly. Compatibility is
tracked by comparing against Prettier on a corpus in CI, with a target of 99% of files byte for
byte. The TypeScript printer is the largest language task and comes last; until then a
`FormatProvider` can do that job.

There is no built-in lint rule engine. Syntax errors come from parsers; everything else arrives
through `DiagnosticsProvider`.

## 11. Search

Search runs against a snapshot in a worker that can be killed. JavaScript's `RegExp` can backtrack
catastrophically, so a time limit stops the worker and reports it rather than hanging. Results
stream in document order into a compact offset array.

Expressions run on overlapping chunks, so matches across chunk boundaries are found. Multi-line
expressions have a maximum span, shown in the UI. A remote document searched by reading every byte
would be slow, so a `SearchProvider` can run the search next to the data instead.

## 12. Workbench

`Workbench` is a convenience: a default arrangement of pieces that can each be used alone.
`EditorGroup`, the views and the status bar are all public, so an application that wants a
different frame composes them itself.

```tsx
<Workbench
  backend={backend}
  languages={[typescript, json, markdown]}
  views={[explorer(), search(), problems(), history(), myTerminalView]}
  layout={savedLayout}
  onLayoutChange={saveLayout}
/>
```

- **Layout** is serialisable JSON: rail, side view, editor groups as a tree of splits, bottom
  panel. An application can remove any part.
- **Views** are one contribution API. Built-in views and the application's own (a terminal, Git, a
  deployment panel) are equal citizens.
- **Commands** build on glass-ux's `defineActions` (R1.2), so the menubar, palette and context menus
  render from one definition.
- **Settings** layer default → application → user → language, and show where a value comes from
  (R6.9).
- **Windows.** A file moves between a tab and a managed window, keeping its document, history and
  selection. It shows in one place at a time. Close guards protect unsaved work (R13.7). Pop-out is
  off, because a popup is another page with none of these documents, and the keymap runs in the
  main document only. Showing one document in two places would need a SharedWorker.

### What the workbench takes from glass-ux

The workbench draws as little as it can.

| Part | glass-ux component |
| --- | --- |
| The frame: top bar, rail, side pane, phone tab bar, F6 regions | `AppShell`, `TopBar`, `Rail`, `TabBar` |
| Side views: header, filter, groups, resizing, Ctrl+B, phone sheet | `SectionDrawer` (built on `Sidebar`) |
| Code windows, the dock, snapping | `glass-ux/windows`: `Workspace`, `Window`, `registerWindowKind` |
| Open, Save as, New file | `FileDialog` |
| Compare with saved | `DiffView` |
| Path above an editor | `Breadcrumb` `size="xs"` |
| Problems and search results | `Tree` |
| Output | `VirtualList` |
| View and find toggles | `Toolbar`, and the `case-sensitive`, `regex` and `whole-word` icons |
| Copy path, announcing a save, debounced search | `useClipboard`, `useAnnounce`, `useDebouncedValue` |
| File tree, rename, right-click | `Tree`, `ActionContextMenu`, `defineActions` |
| Editors and panels: tabs, unsaved, preview, splits, moves, phone | `PaneLayout` |
| Menus, showing rebound keys | `Menubar` |
| Commands, chords, help dialog | `glass-ux/keymap`, `ShortcutHelpDialog` |
| Palette | `SearchTrigger`, `usePaletteCommands` |
| Find and replace | `FindBar` |
| Suggestions at the caret | `Typeahead` |
| Status | `StatusBar` |
| Appearance, confirmations, empty states | `AppearanceSettings`, `AlertDialog`, `EmptyState` |

### Design language

| Rule | How the IDE applies it |
| --- | --- |
| R4.2 One blurred layer | The editor is opaque. Popups are `glass-overlay`. |
| R4.6 Framing on the canvas | Title row, rail and status bar sit on the canvas. |
| R5.8 Space, not dividers | Panes are separated by `--ide-gap`. Flat style reads like VS Code. |
| R7 Containers | Tiers are container queries: the workbench adapts to its box, not the device. |
| R9.1, R10.1 Stability | Notices float over the editor; they never push code down. |
| R3.3 Tones | Danger and warning only for real states. Syntax colours avoid both. |
| R6.7 Phones | The rail becomes the bottom pill, panes become sheets, one editor shows. |

## 13. Public API

One package, `glass-ux-ide`, with one entry per family, built and released like glass-ux: built ESM,
a versioned GitHub release archive, and `glass-ux` as a peer dependency.

### Components

| Entry | Exports |
| --- | --- |
| `glass-ux-ide/editor` | `CodeEditor`, `CodeViewer`, `CodeField` (works in `Field` and TanStack Form) |
| `glass-ux-ide/workbench` | `Workbench`, or the parts in another shell: `WorkbenchProvider`, `useWorkbench`, `EditorArea`, `ExplorerView`, `SearchView`, `ChangesView`, `FileExplorer`, the panels, `WorkbenchMenubar`, `WorkbenchStatusBar`, and the code window kind |
| `glass-ux-ide/backend` | `IdeBackend` and language provider types, `openFile`, `fileTarget`, browser file providers |
| `glass-ux-ide/view`, `/core`, `/react` | `EditorView`, the engine, and hooks, for use without the components |
| `glass-ux-ide/i18n/<tag>` | Language packs |
| `glass-ux-ide/languages/*` | One entry per language |
| `glass-ux-ide/format/*` | Optional formatters |

```tsx
// A small field: controlled, like any glass-ux input.
<Field label="Definition" error={error}>
  <CodeField language="json" value={value} onValueChange={setValue} />
</Field>

// Any size: a document handle, not a string.
const doc = useTextDocument("harbour:/var/log/events.ndjson")
return <CodeEditor document={doc} language="ndjson" aria-label="Events" />
```

`value` and `onValueChange` exist for small content and follow glass-ux's controlled pattern
(R22.3). Above tier 0 they warn in development, because a string cannot represent a huge document.

### Hooks

| Hook | Returns |
| --- | --- |
| `useTextDocument(uri)` | Open or share a document; suspends until ready |
| `useEditor()` | The nearest editor: selections, viewport, commands |
| `useSelection(editor)` | The selection, re-rendering only when it changes |
| `useDiagnostics(uri)` | Live diagnostics from every source |
| `useDocumentHistory(doc)` | Undo, redo, branches, saved versions |
| `useBackend()` | The registered backend and which features it provides |
| `useFileSystem(scheme)` | A registered provider |
| `useCommand(id)` | Run a command, with its enablement and keybinding |
| `useWorkbench()` | Open files, reveal views, split groups, read layout |

### Headless

`glass-ux-ide/core` needs no DOM and no React:

```ts
const doc = await createDocument({ uri, files: myFiles })
doc.edit().replace(range, "next").commit()
for await (const match of doc.snapshot().search(/ERROR/)) report(match)
await doc.save()
```

## 14. Accessibility

Target: WCAG 2.2 AA in both modes, every palette and every material, per R20.

- **Screen readers.** The editor is `role="textbox"` with `aria-multiline` and a required
  `aria-label`. The current page of text is mirrored in the input element, so lines read in full.
  Screen reader mode is detected and can be set by hand.
- **Keyboard.** Every action has a keyboard path. F6 moves between regions. Tab inserts indentation,
  so Ctrl+M switches it to moving focus; without this a keyboard user is trapped (WCAG 2.1.2).
  Alt+F1 opens help for the focused editor.
- **Announcements.** Diagnostics, search counts and save results use polite live regions that stay
  mounted (R20.9). F8 steps through problems and reads each one.
- **Forced colours.** Every marker keeps a shape: errors are square, warnings round, unsaved is a
  dot in `CanvasText`, the active suggestion a `Highlight` outline (R20.10). The first mock-up
  review found three of these missing, so this has a dedicated browser test.
- **Zoom and motion.** Editor text follows UI scale and browser zoom. Smooth scrolling and caret
  blink stop under Still and reduced motion.
- **Scroller.** The scaled scroller exposes `role="scrollbar"` with real values (R20.6).
- **Touch.** Targets stay at `--target-min` on coarse pointers (R21.4).

Checks: axe in every Playwright spec, plus a recorded manual pass with NVDA, VoiceOver and Orca
before each release. Automated checks cannot prove a screen reader experience, so the manual pass
is part of the definition of done.

## 15. Internationalisation

- **Messages.** Every built-in word is declared with `defineMessages` from `glass-ux/i18n` beside
  its component and read with `useMessages`, so IDE words join the application's catalogue and
  `MessagesProvider` overrides.
- **Packs.** Arabic, German, Spanish, French, Hebrew, Italian, Japanese, Korean, Dutch, Brazilian
  Portuguese and Simplified Chinese, matching glass-ux. A coverage test fails when one is missing.
- **Parser messages** are messages too, with stable ids. Text from a provider passes through as
  written, because it belongs to the application.
- **Direction.** Chrome mirrors with logical properties (`logical:check`). The code surface and
  minimap stay left to right. Bidirectional text inside a line follows the Unicode algorithm
  through the DOM.
- **Input methods.** IME composition is tested with Japanese, Korean and Chinese on every engine.
- **Numbers.** Status text uses the glass-ux locale helpers, with proper plurals. Gutters use ASCII
  digits so columns stay aligned.

## 16. Documentation and demo site

The docs match glass-ux component for component:

- **TSDoc** on every public type, prop, hook and function.
- **`docs/api/*.md`** generated by a TypeDoc and compiler-API script (`pnpm docs:api`), in the same
  table format, so a typed prop can never drift from its description.
- **`docs/components/*.md`** guides, plus `llms.txt`, `AGENTS.md` and installable agent skills.
- **`pnpm docs:check`** fails when a public export lacks documentation, a page or a demo.
- **Each component page** has live examples, usage, full API, keyboard map, accessibility notes and
  translations.
- **Backend guides** cover each interface, a language server adapter, and the RPC protocol.

The demo site is a static build on GitHub Pages at `dastari.github.io/glass-ux-ide/`, deployed by a
workflow based on glass-ux's `pages.yml`, with `pnpm test:production` against the built site. It
runs entirely client-side:

- sample projects in browser storage;
- **a synthetic 100 GB file** generated deterministically on demand, so anyone can try huge-file
  editing without downloading anything;
- **a demo backend in a worker** implementing `IdeBackend`, so completion, hover and diagnostics are
  visible, and its source doubles as the reference implementation.

The published glass-ux package does not include the gallery or docs scripts, so they are ported
here unless the docs kit moves upstream (section 18).

## 17. Testing and budgets

| Kind | Coverage |
| --- | --- |
| Model tests | Random edit sequences against a naive string model, with shrinking. |
| Crash tests | Kill the worker at random points in a save and journal write, then verify recovery. |
| Parser tests | Round-trip (`parse(x).text === x`) on a corpus and on truncated or broken input. |
| Formatter tests | Idempotence, plus the Prettier comparison corpus. |
| Backend tests | `testBackend` runs against every built-in provider and the demo backend. |
| Browser tests | Playwright in Chromium, Firefox and WebKit, with axe, forced colours, RTL and phone. |
| Performance | Fixtures driven by the synthetic file, with budgets enforced in CI. |

The glass-ux checks apply unchanged: `tokens:check`, `logical:check`, `css-perf:check`,
`boundaries:check`, `pure:check`, `size:check`, `glass-ux check-layout`.

### Targets

Engine figures are measured in [performance.md](performance.md). Browser figures come with Phase 2.

| Measure | Target |
| --- | --- |
| Keystroke to paint, p99, any file size | 16 ms |
| Open a 50 GB file to first paint | 300 ms |
| Jump to any byte, local SSD | 50 ms |
| Scroll, row patch per frame | 4 ms |
| Main-thread memory per document, any size | 50 MB |
| Worker memory, default budget | 512 MB |
| Line index throughput, local SSD | 1 GB/s |
| `glass-ux-ide/editor`, gzip, no languages | 120 KB |
| One language's lexer, gzip | 5 KB |

## 18. What lives in base glass-ux

glass-ux must not depend on this package, so anything needing the text engine stays here. The
requests in [glass-ux-request.md](glass-ux-request.md) all shipped in glass-ux 0.14.0, and section
12 lists what the workbench uses.

Still drawn or held here: nothing the workbench needs. `src/ui/workbench/layout.ts` builds three
changes from `pane-layout`'s functions: showing a panel without moving it, collapsing a stack, and
renaming a panel in place. `combineMessagePacks` exists because registering a second pack for a language
replaces the first. `SearchTrigger` ignores `aria-label`, so a custom placeholder fails label in
name, and the workbench keeps the default wording.

## 19. Repository layout

```
glass-ux-ide/
├── src/
│   ├── core/         buffer, history, search, encodings (no DOM)
│   ├── backend/      interfaces, built-in providers, rpc, testing
│   ├── languages/    one folder each: lexer, optional parser
│   ├── format/       optional formatters
│   ├── view/         EditorView, row pool, input (no React)
│   ├── react/        hooks
│   ├── ui/           components, each with css, messages.ts, tests
│   ├── workbench/    layout, views, settings
│   └── i18n/         language packs
├── apps/docs/        demo and documentation site
├── docs/             guides and generated API pages
├── e2e/, scripts/, skills/
└── mockups/          this design's mock-ups
```

## 20. Delivery plan

| Phase | Gate | State |
| --- | --- | --- |
| **0 Foundations** | An empty page live on GitHub Pages with generated API docs | **Done.** Checks, docs kit, generated API, and a site deployed from `main`. |
| **1 Engine** | Budgets met on a 100 GB synthetic file | **Done.** |
| **2 Surface** | Keystroke and scroll budgets; NVDA and VoiceOver pass | **Budgets met, DOM chosen.** Firefox and WebKit run in CI. An automated accessibility scan passes; a pass with NVDA and VoiceOver by a person has not been done. |
| **3 Files and history** | Crash tests pass; undo works across saves | **Done.** A journal of each file's operations survives a crash or a reload and replays the same text and undo steps; `TimelineView` shows and restores history. |
| **4 Backend** | A sample app connects a language server through the interfaces | **Done** with the demo's language service: completion, diagnostics, hover, go to definition, rename, format and document sync. No real language server tried yet. |
| **5 Workbench** | The mock-ups, running for real on the demo site | **Done** on `AppShell`: search across files, comparing with saved, code windows and split editors on one document. |
| **6 Formatter and extras** | Formatter corpus at target | **A first formatter**: it re-indents and tidies whitespace for TypeScript, JavaScript, JSX, JSON, CSS and Markdown, and changes 0.3% of this project's own lines. It does not reflow lines as Prettier does. |

### Known limits in 0.1.0

- Crash recovery stops journaling a file when an undo or a timeline jump goes back past its last
  save, until the next save, because the steps before it are not in the journal.
- Document sync and Compare with saved cover files up to 5 MB.
- Code windows do not pop out: a popup is another page without this one's documents or keymap.
- Under Playwright's WebKit, every write to the origin private file system (`browserFiles`) fails with
  "an unknown transient reason", so that test is marked as known to fail there. Safari has not been tried.
- glass-ux follow-ups are in [glass-ux-request.md](glass-ux-request.md), at the end.

## 21. Risks

| Risk | Likelihood | Response |
| --- | --- | --- |
| Input and IME bugs across browsers. | High | Test matrix from Phase 2 on all three engines. |
| The TypeScript formatter takes far longer than planned. | High | It is optional and last. `FormatProvider` covers the gap. |
| The provider interfaces prove wrong in real use. | Medium | The Phase 4 sample app and demo backend test them before they are frozen. Keep them pre-1.0 until a real application adopts them. |
| Browser file APIs differ or change. | Medium | `FileSystemProvider` isolates them. |
| Proxying reads through the main thread is too slow. | Medium | `fileWorker` runs a provider inside the worker. |
| Row pool misses budget in a real host page, or at high refresh rates. | Low | Measured at 60 Hz with no surrounding UI. Re-measure inside the workbench in Phase 5. |
| glass-ux API changes. | Medium | Pin a release; this project doubles as an adoption test. |

### Not confirmed yet

- Search confirmed `showOpenFilePicker` is Chromium-only, but from undated sources that did not
  cover `createWritable` behaviour.
- Browser element-height limits, `Blob.slice` on very large files, and reads failing after a file
  changes on disk come from general knowledge and need measuring in Phase 1.

## 22. Out of scope

Server software of any kind, authentication and security, a terminal emulator, Git and debugger
views, a built-in linter, a built-in LSP client, VS Code extension compatibility, a marketplace,
real-time collaboration, proportional fonts and native desktop packaging.

An LSP client is the item most likely to be requested later. The provider interfaces follow LSP's
concepts so an application can adapt a server itself, and the docs include that recipe.
