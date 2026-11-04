# Workbench

An IDE as one component: application frame, activity rail, side views, tabbed and splittable
editors, code windows, panels, menus, commands and a status bar. It fills its parent, which needs
a definite height. To use the parts in a shell you already have, start from `WorkbenchProvider`.

`import { Workbench } from "glass-ux-ide/workbench"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/workbench)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| account | `ReactNode` | See type | no | — | The end of the top bar, usually an `AccountButton`. |
| actions | `ReactNode` | See type | no | — | Beside the search in the top bar, such as a theme toggle. |
| backend | `IdeBackend & { files: readonly FileProvider[]; }` | See type | yes | — | Where files come from and what provides language features. Only `files` is needed. |
| brand | `ReactNode` | See type | no | — | The top-left corner, usually a `ShellBrand`. |
| createWorker | `(() => Worker) \| undefined` | See type | no | — | Makes a document worker. Default: the package's worker, which most bundlers can find. |
| initialFiles | `readonly string[] \| undefined` | See type | no | — | Files open at the start. |
| inspector | `ReactNode` | See type | no | — | A second side pane, usually an `Inspector`. |
| lexers | `Readonly<Record<string, Lexer>> \| undefined` | See type | no | — | Highlighting by file extension, such as `{ ts: typescriptLexer }`. |
| panels | `readonly WorkbenchPanel[] \| undefined` | See type | no | — | The application's own panels, beside Problems and Output. |
| recovery | `RecoveryStore \| null \| undefined` | See type | no | — | Where unsaved edits are kept, so a crash or a closed tab loses nothing: they are offered back when the file next opens. Default: the browser's IndexedDB. `null` keeps none. |
| storageKey | `string \| undefined` | See type | no | — | Where the layout is remembered. Leave out to remember nothing. |
| views | `readonly WorkbenchView[] \| undefined` | See type | no | NO_VIEWS | The application's own views, after Explorer, Search and Changes. |
| windows | `WindowManager \| undefined` | See type | no | — | The window manager to open code windows in. Default: one of its own. |
