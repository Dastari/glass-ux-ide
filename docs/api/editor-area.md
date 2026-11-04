# EditorArea

The tabbed, splittable editors and the panels beneath them. Drag a tab to split, or use its
menu. It fills its parent, which needs a definite height.

`import { EditorArea } from "glass-ux-ide/workbench"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/editor-area)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| className | `string \| undefined` | See type | no | — | Classes applied to the outer element for layout. Use the component props and theme tokens for its appearance. |
| collapseBelow | ``${number}rem` \| undefined` | See type | no | "28rem" | Below this width the layout shows one panel at a time with a strip of the rest. Default "28rem", a phone. |
