# CodeField

Code in a form: a `Field` holding an editor, so it has a label, a hint and an error like any other
control, and works with `useAppForm` through `value`, `onValueChange` and `onBlur`.

`import { CodeField } from "glass-ux-ide/editor"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/code-field)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| defaultValue | `string \| undefined` | See type | no | — | The initial text when uncontrolled. |
| height | `string \| undefined` | See type | no | "11rem" | The editor's height. Default 11rem. |
| lexer | `Lexer \| undefined` | See type | no | — | Highlighting rules, such as `typescriptLexer`. |
| onBlur | `(() => void) \| undefined` | See type | no | — | Called when focus leaves, for a form's validate-on-blur (R15.9). |
| onValueChange | `((value: string) => void) \| undefined` | See type | no | — | Called with the text after an edit. |
| readOnly | `boolean \| undefined` | false, true | no | — | Keeps navigation, selection and copy, and refuses edits. |
| value | `string \| undefined` | See type | no | — | Controlled text. |

Inherited properties:

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| aside | `ReactNode` | See type | no | — | Right side of the label row: a live value readout or a small link. |
| className | `string \| undefined` | See type | no | — | Classes applied to the outer element for layout. Use the component props and theme tokens for its appearance. |
| error | `ReactNode` | See type | no | — | Replaces the hint in place. Setting it marks the field and its control invalid. |
| hint | `ReactNode` | See type | no | — | The message line's resting text. Only when the format or consequence is not obvious (R2.8). |
| label | `ReactNode` | See type | no | — | Names the control. Omit only when a group legend or `aria-label` names it instead. |
| message | `"reserve" \| "auto" \| undefined` | "reserve", "auto" | no | — | reserve: the message line always exists (default for vertical fields), so an error never moves anything (R9.1). auto: only rendered when there is a hint, error or counter. |
| optional | `boolean \| undefined` | false, true | no | — | Marks the label "Optional". Prefer this over marking required fields. |
| required | `boolean \| undefined` | false, true | no | — | Shows the required marker. Pass `required` to the control as well. |
| warning | `ReactNode` | See type | no | — | Non-blocking warning in the reserved message slot; errors take precedence. |
