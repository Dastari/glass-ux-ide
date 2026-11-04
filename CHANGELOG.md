# Changelog

## Unreleased

- Needs glass-ux 0.16. `TimelineView` uses ActivityFeed's timeline variant: the steps are joined by a
  rail, and each time follows its step's text so labels fit a side drawer.

## 0.1.1 (4 November 2026)

### Fixes
- Each part loads its own styles. Using `EditorArea`, a view or a panel without `Workbench` lost the
  editor's and workbench's stylesheets in a production build, leaving the editor unstyled.
- Diagnostics arrive for every open file, not only a file an editor shows, so the Problems panel and
  the status bar count background tabs and windows.
- Sizes in the status bar use glass-ux's `formatBytes` ("48 B", "107.4 GB").

### Changes
- `CodeEditor` draws its own edge and corners. `framed={false}` turns them off inside a panel or a
  window body.
- `EditorArea` shows one panel at a time only below 28rem, a phone, and takes `collapseBelow`.
- `SearchView` takes `defaultQuery`.

### Documentation
- Every example shows its part in a panel and in use, and the code windows demo fills its box.

## 0.1.0 (4 November 2026)

The first release. Built on glass-ux 0.15.0 and React 19.

### Editing
- `CodeEditor`, `CodeViewer` and `CodeField`: an editor for files of any size, read a page at a time in a
  worker. Measured on real files: a 20 GB file opens in 56 ms, and a keystroke paints in 6.3 ms at the
  slowest 1%.
- Undo and redo across saves, with branches, and the caret put back where each step was made.
- Lexers for TypeScript and JavaScript with JSX, JSON, CSS, Markdown and HTML.
- `glass-ux-ide/format`: a formatter that re-indents by brackets and tidies whitespace, in the page.

### Workbench
- `Workbench`: an IDE in one component, on `AppShell`, with an activity rail, Explorer, Search, Changes and
  Timeline views, tabbed and split editors, Problems, Output and the application's own panels, menus, a
  command palette, keyboard shortcuts with chords and a status bar.
- Its parts for an application's own shell: `WorkbenchProvider`, `useWorkbench`, `EditorArea`, the views,
  the panels, `WorkbenchMenubar` and `WorkbenchStatusBar`.
- Code windows in the glass-ux window manager, and two editors of one file side by side.
- New file, Open and Save as through `FileDialog`; Compare with saved through `DiffView`.
- Crash recovery: a journal of each file's operations, kept in IndexedDB by default, offered back with
  the same undo steps after a crash or a reload.

### Backends
- Interfaces an application implements, every one optional: files through any glass-ux `FileProvider`,
  completion, diagnostics, hover, go to definition, rename, format, document sync and project search.
- In the browser with no backend: `browserFiles`, `folderFiles`, `httpFiles`, `browserSearch` and
  `browserRecovery`.

### Languages and access
- Every word in 11 language packs besides English, with right-to-left layout.
- F6 moves between regions; an automated accessibility scan of the demo passes.

### Documentation
- A documentation site in the glass-ux format, with a page for each component, guides, the API reference
  and the demo application at `/demo`.

Known limits are listed in [docs/DESIGN.md](docs/DESIGN.md), section 20.
