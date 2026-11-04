# WorkbenchProvider

Holds a workbench's open files, layout, commands and dialogs, and draws nothing else. Use it to
place the parts in an application that already has its own shell. `Workbench` is this with a
frame around it. It needs a `PaletteProvider` above it, and a `WindowManagerProvider` for files
to open in managed windows.

`import { WorkbenchProvider } from "glass-ux-ide/workbench"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/workbench-provider)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| backend | `IdeBackend & { files: readonly FileProvider[]; }` | See type | yes | — | Where files come from and what provides language features. Only `files` is needed. |
| children | `ReactNode` | See type | yes | — | The parts: `EditorArea`, the views and panels, and anything else that uses {@link useWorkbench }. |
| createWorker | `(() => Worker) \| undefined` | See type | no | — | Makes a document worker. Default: the package's worker, which most bundlers can find. |
| initialFiles | `readonly string[] \| undefined` | See type | no | — | Files open at the start. |
| lexers | `Readonly<Record<string, Lexer>> \| undefined` | See type | no | — | Highlighting by file extension, such as `{ ts: typescriptLexer }`. |
| panels | `readonly WorkbenchPanel[] \| undefined` | See type | no | — | The application's own panels, beside Problems and Output. |
| recovery | `RecoveryStore \| null \| undefined` | See type | no | — | Where unsaved edits are kept, so a crash or a closed tab loses nothing: they are offered back when the file next opens. Default: the browser's IndexedDB. `null` keeps none. |
| storageKey | `string \| undefined` | See type | no | — | Where the layout is remembered. Leave out to remember nothing. |
