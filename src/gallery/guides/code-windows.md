# Code windows

Editors work inside the glass-ux window manager, so an application can keep several files on screen
in windows that float, snap, tile and minimise to the dock.

## A CodeEditor in any window

A window kind says how to title a window and what its body is. The body can be a `CodeEditor`.

```tsx
import { registerWindowKind, Window, type WindowContentProps } from "glass-ux/windows"
import { IconFile } from "glass-ux/icons"
import { CodeEditor } from "glass-ux-ide/editor"

function SnippetWindow({ params }: WindowContentProps<{ text: string }>) {
  return (
    <Window.Body variant="fill">
      <CodeEditor aria-label="Snippet" defaultValue={params.text} />
    </Window.Body>
  )
}

registerWindowKind<{ text: string }>({
  kind: "my-app.snippet",
  title: () => "Snippet",
  icon: IconFile,
  load: async () => ({ default: SnippetWindow }),
})
```

Open one with `useWindowManager().open({ kind: "my-app.snippet", params: { text } })` under a
`WindowManagerProvider` and a `Workspace`.

## Files in windows

`Workbench` has a window manager of its own, or uses the one in its `windows` prop. Open in new
window, in a tab's menu, a file's menu and the Window menu, moves a file out of its tab, keeping its
undo history and selection. Move to a tab brings it back. A window closes through the same unsaved
check as a tab.

Outside `Workbench`, put `WorkbenchProvider` under your `WindowManagerProvider`, then call
`useWorkbench().openInWindow(uri)`. A file shows in one place at a time: opening it again brings its
window forward.

Code windows do not pop out into a browser window. A popup is another page, so it has none of this
page's open documents, and the glass-ux keymap runs in the main document only.
