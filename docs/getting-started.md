# Getting started

`glass-ux-ide` is a component library built on `glass-ux`. It holds a code editor, the parts of an
IDE and the interfaces an application fills in. It ships no server, agent or background process:
your application supplies files and language features, and anything it leaves out simply does not
appear.

## Add an editor

The smallest use is one editor over short text. Give its parent a definite height.

```tsx
import { CodeEditor } from "glass-ux-ide/editor"
import { typescriptLexer } from "glass-ux-ide/languages/typescript"

export function Snippet() {
  return (
    <div style={{ blockSize: "20rem" }}>
      <CodeEditor aria-label="Snippet" defaultValue="const a = 1" lexer={typescriptLexer} />
    </div>
  )
}
```

Lexers ship for TypeScript and JavaScript (`glass-ux-ide/languages/typescript`), JSON, CSS, Markdown
and HTML (`glass-ux-ide/languages/json` and so on). `CodeViewer` shows code without editing it, and `CodeField` puts an editor in a form with a label,
hint and error like any other control.

## Open a file of any size

`value` is for short text. A file belongs in a `document`, which reads a page at a time in a worker,
so a 100 GB file opens as fast as a small one.

```tsx
import { openFile } from "glass-ux-ide/backend"
import { CodeEditor } from "glass-ux-ide/editor"

const opened = await openFile(new Worker(workerUrl, { type: "module" }), files, "project:///server.log")

<CodeEditor aria-label="server.log" document={opened.handle} />
```

## Add a whole IDE

`Workbench` is the application frame, activity rail, side views, tabs and splits, code windows,
panels, menus, commands and status bar, as one component. It needs a `PaletteProvider` and the usual
glass-ux providers above it, and a parent with a definite height.

```tsx
import { memoryFiles } from "glass-ux/file-provider/memory"
import { typescriptLexer } from "glass-ux-ide/languages/typescript"
import { Workbench } from "glass-ux-ide/workbench"

const backend = { files: [memoryFiles({ "src/main.ts": "console.log(1)\n" }, { scheme: "project", label: "Project" })] }

export function Ide() {
  return <Workbench backend={backend} lexers={{ ts: typescriptLexer }} initialFiles={["project:///src/main.ts"]} />
}
```

## Use the parts in your own shell

An application that already has an `AppShell` should not nest another. Start from
`WorkbenchProvider`, which holds the open files, layout, commands and dialogs and draws nothing, and
place the parts where they belong.

```tsx
<WorkbenchProvider backend={backend}>
  <AppShell
    drawer={<ExplorerView />}
    topBar={<TopBar module={<WorkbenchMenubar />} />}
    rail={yourRail}
    brand={yourBrand}
  >
    <EditorArea />
    <WorkbenchStatusBar />
  </AppShell>
</WorkbenchProvider>
```

## Languages and direction

Every word comes from `workbenchMessages`, with a pack for each of glass-ux's languages under
`glass-ux-ide/i18n/<tag>`. Registering a second pack for a language replaces the first, so join them:

```ts
import { registerMessagePack } from "glass-ux/i18n"
import glassUx from "glass-ux/i18n/ar"
import workbench from "glass-ux-ide/i18n/ar"
import { combineMessagePacks } from "glass-ux-ide/workbench"

registerMessagePack(combineMessagePacks(glassUx, workbench))
```

## What to read next

`useWorkbench` gives any component inside the provider the same operations the parts use: `open`,
`save`, `close`, `reveal`, `showPanel` and the rest. Next, [connect a backend](backends.md) or
[put code in windows](code-windows.md).
