# FileExplorer

A file tree over any `FileProvider`. Folders load when opened and rows offer only what the
provider can do: without `rename` there is no rename, so a read-only source simply reads.

`import { FileExplorer } from "glass-ux-ide/workbench"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/file-explorer)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| onOpen | `(uri: FileUri, options: { preview: boolean; }) => void` | See type | yes | — | Called when a person opens a file. `preview` is a single click, which a later open may replace. |
| onOpenInWindow | `((uri: FileUri) => void) \| undefined` | See type | no | — | Adds Open in new window to each file's menu. |
| providers | `readonly FileProvider[]` | See type | yes | — | Where files come from. With more than one, each is a top-level folder. |
| query | `string \| undefined` | See type | no | — | Filters rows by name. |
| ref | `Ref<FileExplorerHandle> \| undefined` | See type | no | — | Receives the underlying element for focus or measurement. React 19 accepts ref as a normal prop. |
| selected | `string \| null \| undefined` | See type | no | — | The file shown as selected. |
