# CodeViewer

Shows code of any size, with the same scrolling and highlighting, and no editing.

`import { CodeViewer } from "glass-ux-ide/editor"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/code-viewer)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| aria-label | `string` | See type | yes | — | Names the editor for assistive technology. |
| className | `string \| undefined` | See type | no | — | Classes applied to the outer element for layout. Use the component props and theme tokens for its appearance. |
| describedBy | `string \| undefined` | See type | no | — | The id of an element describing the editor. |
| document | `DocumentHandle \| undefined` | See type | no | — | A document of any size, from `openFile` or `connectDocument`. Takes priority over `value`. |
| lexer | `Lexer \| undefined` | See type | no | — | Highlighting rules, such as `typescriptLexer`. |
| onStatus | `((status: EditorStatus) => void) \| undefined` | See type | no | — | Reports the caret, the size tier and the line numbers' exactness. |
| ref | `Ref<CodeEditorHandle> \| undefined` | See type | no | — | Receives the underlying element for focus or measurement. React 19 accepts ref as a normal prop. |
| screenReader | `boolean \| undefined` | false, true | no | — | Mirror the current line into the input, for screen readers. |
| value | `string \| undefined` | See type | no | — | Controlled text, for short content. A large file belongs in a `document`. |
