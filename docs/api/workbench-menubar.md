# WorkbenchMenubar

The workbench's menus, built from its commands, so a menu row, a shortcut and the palette always agree.

`import { WorkbenchMenubar } from "glass-ux-ide/workbench"`

[Live examples](https://dastari.github.io/glass-ux-ide/components/workbench-menubar)

## Props

| Prop | Type | Valid options | Required | Default | Description |
| --- | --- | --- | --- | --- | --- |
| className | `string \| undefined` | See type | no | — | Classes applied to the outer element for layout. Use the component props and theme tokens for its appearance. |
| viewCommands | `readonly WorkbenchCommand[] \| undefined` | See type | no | [] | Commands of your own, shown at the end of the View menu. |
