// tokens:allow-file boxes that give a demo the definite height its component needs
import { useEffect, type ReactNode } from "react"
import { memoryFiles } from "glass-ux/file-provider/memory"
import { Example, SectionPage, Specimen } from "glass-ux-docs-kit/react"
import { typescriptLexer } from "../../languages/typescript/index.js"
import { ChangesPanel, ChangesView, TimelineView, EditorArea, ExplorerView, FileExplorer, OutputPanel, ProblemsPanel, SearchView, WelcomePanel, Workbench, WorkbenchMenubar, WorkbenchProvider, WorkbenchStatusBar, useWorkbench } from "../../ui/workbench/index.js"

const MAIN = "example:///src/main.ts"
const project = memoryFiles(
  { "src/main.ts": 'const unused = 1\n\nconsole.log(greet("harbour"))\n', "src/greet.ts": "export const greet = (name: string) => `Hello, ${name}`\n", "README.md": "# Example\n" },
  { scheme: "example", label: "Example" },
)
const backend = {
  files: [project],
  diagnostics: {
    subscribe(uri: string, report: (found: []) => void) {
      if (uri !== MAIN) report([])
      else report([{ severity: "warning", message: "unused is never read.", source: "demo", range: { start: { line: 0, column: 6 }, end: { line: 0, column: 12 } } }] as never)
      return () => undefined
    },
  },
}
const lexers = { ts: typescriptLexer }
const opening = [MAIN]

/** A workbench's state with no frame, so one part can show by itself. */
function Parts({ children, height = "16rem" }: { children: ReactNode; height?: string }) {
  return (
    <div className="w-full" style={{ blockSize: height }}>
      <WorkbenchProvider backend={backend} lexers={lexers} initialFiles={opening}>
        {children}
      </WorkbenchProvider>
    </div>
  )
}

/** Writes one line, so the panel beside it has something to show. */
function Logged({ children }: { children: ReactNode }) {
  const { log } = useWorkbench()
  useEffect(() => log.write("Saved main.ts"), [log])
  return children
}

export default function WorkbenchSection() {
  return (
    <SectionPage>
      <Specimen title="Workbench" description="Everything as one component. It fills its parent, which needs a definite height.">
        <Example label="Files in memory" className="w-full">
          <div className="h-144 w-full">
            <Workbench backend={backend} lexers={lexers} initialFiles={opening} />
          </div>
        </Example>
      </Specimen>
      <Specimen title="WorkbenchProvider" description="Holds the state and draws nothing, so the parts can go in a shell you already have.">
        <Example label="Two parts of a host's layout" className="w-full">
          <Parts height="24rem">
            <div style={{ display: "grid", gridTemplateColumns: "15rem minmax(0, 1fr)", blockSize: "100%" }}>
              <FileExplorer providers={backend.files} onOpen={() => undefined} />
              <EditorArea />
            </div>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="EditorArea" description="Tabs, splits and the panels beneath them. Drag a tab to split, or use its menu.">
        <Example label="One file" className="w-full">
          <Parts height="22rem">
            <EditorArea />
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="FileExplorer" description="Lists any provider, and offers only what that provider can do.">
        <Example label="Files in memory" className="w-full">
          <div className="w-full" style={{ blockSize: "12rem" }}>
            <FileExplorer providers={backend.files} onOpen={() => undefined} />
          </div>
        </Example>
      </Specimen>
      <Specimen title="ExplorerView" description="The side view: open files, then folders, with a filter that stays put.">
        <Example label="In a drawer" className="w-full">
          <Parts height="24rem">
            <div style={{ display: "grid", inlineSize: "18rem", blockSize: "100%" }}>
              <ExplorerView />
            </div>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="SearchView" description="Searches every file. It uses the application's search provider when there is one, otherwise it reads files in the page.">
        <Example label="In a drawer" className="w-full">
          <Parts height="20rem">
            <div style={{ display: "grid", inlineSize: "18rem", blockSize: "100%" }}>
              <SearchView />
            </div>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="ChangesView" description="Files with unsaved edits. Choosing one compares it with what was saved.">
        <Example label="Nothing changed yet" className="w-full">
          <Parts height="14rem">
            <div style={{ display: "grid", inlineSize: "18rem", blockSize: "100%" }}>
              <ChangesView />
            </div>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="TimelineView" description="The active file's undo history, with its branches. Choosing a step goes back, or forward, to it.">
        <Example label="A file just opened" className="w-full">
          <Parts height="14rem">
            <div style={{ display: "grid", inlineSize: "18rem", blockSize: "100%" }}>
              <TimelineView />
            </div>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="ProblemsPanel" description="Every open file's diagnostics, grouped by file. Choosing one selects it in the editor.">
        <Example label="One warning" className="w-full">
          <Parts height="10rem">
            <ProblemsPanel />
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="OutputPanel" description="A running record of what the workbench did. Write to it with useWorkbench().log.">
        <Example label="After a save" className="w-full">
          <Parts height="6rem">
            <Logged>
              <OutputPanel />
            </Logged>
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="ChangesPanel" description="A file against what was last saved, in a stack of its own. The panel's id names the file.">
        <Example label="No edits yet" className="w-full">
          <Parts height="8rem">
            <ChangesPanel id={`diff:${MAIN}`} />
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="WelcomePanel" description="What an editor stack shows when nothing is open.">
        <Example label="Empty" className="w-full">
          <Parts height="12rem">
            <WelcomePanel />
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="WorkbenchMenubar" description="Built from the workbench's commands, so a menu row, a shortcut and the palette always agree.">
        <Example label="Menus" className="w-full">
          <Parts height="3rem">
            <WorkbenchMenubar />
          </Parts>
        </Example>
      </Specimen>
      <Specimen title="WorkbenchStatusBar" description="Problems, the caret, the file's size and any shortcut in progress.">
        <Example label="One file open" className="w-full">
          <Parts height="3rem">
            <WorkbenchStatusBar />
          </Parts>
        </Example>
      </Specimen>
    </SectionPage>
  )
}
