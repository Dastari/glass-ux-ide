# CodeEditor

Edits a document of any size in a bounded box. Give the parent a definite height (R7.3).
Use `document` for files, and `value` or `defaultValue` for short content.

`import { CodeEditor } from "glass-ux-ide/editor"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/code-editor)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| aria-label | `string` | See type | yes | — | Names the editor for assistive technology. |
| className | `string \| undefined` | See type | no | — | Classes applied to the outer element for layout. Use the component props and theme tokens for its appearance. |
| defaultValue | `string \| undefined` | See type | no | "" | The initial text when uncontrolled. |
| describedBy | `string \| undefined` | See type | no | — | The id of an element describing the editor. |
| document | `DocumentHandle \| undefined` | See type | no | — | A document of any size, from `openFile` or `connectDocument`. Takes priority over `value`. |
| invalid | `boolean \| undefined` | false, true | no | — | Marks the content as failing validation. |
| lexer | `Lexer \| undefined` | See type | no | — | Highlighting rules, such as `typescriptLexer`. |
| onStatus | `((status: EditorStatus) => void) \| undefined` | See type | no | — | Reports the caret, the size tier and the line numbers' exactness. |
| onValueChange | `((value: string) => void) \| undefined` | See type | no | — | Called with the text after an edit. Not called for a `document`. |
| readOnly | `boolean \| undefined` | false, true | no | — | Keeps navigation, selection and copy, and refuses edits. |
| ref | `Ref<CodeEditorHandle> \| undefined` | See type | no | — | Receives the underlying element for focus or measurement. React 19 accepts ref as a normal prop. |
| screenReader | `boolean \| undefined` | false, true | no | — | Mirror the current line into the input, for screen readers. |
| value | `string \| undefined` | See type | no | — | Controlled text, for short content. A large file belongs in a `document`. |
