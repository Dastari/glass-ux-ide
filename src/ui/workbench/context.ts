import { createContext, use, type ComponentType, type ReactNode } from "react"
import type { FileUri } from "glass-ux/file-provider"
import type { PaneLayoutState } from "glass-ux/pane-layout"
import type { IdeBackend } from "../../backend/language.ts"
import type { Lexer } from "../../core/lexer.ts"
import type { WorkbenchStore } from "./store.ts"

/** What an editor can be asked to show from outside it. */
export type EditorRequest = "find" | "hover"

/** Asks a file's focused editor to show its find bar or a hover at the caret. */
export class FindRequests {
  private listeners = new Map<FileUri, Set<(request: EditorRequest) => void>>()
  private latest = new Map<FileUri, (request: EditorRequest) => void>()

  subscribe(uri: FileUri, listener: (request: EditorRequest) => void) {
    let listeners = this.listeners.get(uri)
    if (!listeners) this.listeners.set(uri, (listeners = new Set()))
    listeners.add(listener)
    this.latest.set(uri, listener)
    return () => {
      listeners.delete(listener)
      if (this.latest.get(uri) === listener) this.latest.delete(uri)
    }
  }

  /** Marks the editor a request goes to, as focus moves between two editors of one file. */
  focus(uri: FileUri, listener: (request: EditorRequest) => void) {
    this.latest.set(uri, listener)
  }

  open(uri: FileUri, request: EditorRequest = "find") {
    ;(this.latest.get(uri) ?? [...(this.listeners.get(uri) ?? [])].at(-1))?.(request)
  }
}

/** The output panel's lines, kept out of React so writing one re-renders only that panel. */
export class OutputLog {
  private lines: readonly string[] = []
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.lines

  write(line: string) {
    this.lines = [...this.lines, line].slice(-500)
    for (const listener of this.listeners) listener()
  }
}

/** An application's own panel beside Problems and Output, such as a terminal. */
export interface WorkbenchPanel {
  /** A stable id, unique among panels. */
  id: string
  title: string
  icon?: ReactNode
  /** Keep it stable: a new identity remounts the panel. */
  component: ComponentType<{ id: string }>
  /** Keep effects running while the panel is hidden, for anything that must stay connected. */
  keepRunning?: boolean
}

/** What every part of a workbench shares. Read it with {@link useWorkbench}. */
export interface WorkbenchContextValue {
  /** What is open, outside React. */
  store: WorkbenchStore
  /** The Output panel's lines. Write to it to report something. */
  log: OutputLog
  backend: IdeBackend
  /** Opens the find bar in an editor. */
  findRequests: FindRequests
  /** The file a person is working in: the focused window's, or the active tab's. */
  activeUri: FileUri | null
  /** Changes when the workbench adds a file, so a list of files can read again. */
  filesVersion: number
  /** The application's own panels. */
  panels: readonly WorkbenchPanel[]
  lexerFor(uri: FileUri): Lexer | undefined
  nameOf(uri: FileUri): string
  /** Opens a file in a tab, or brings it forward where it already is. `preview` tabs give way to the next one. */
  open(uri: FileUri, options?: { preview?: boolean }): Promise<void>
  /** Opens a file and selects a range, in lines and columns. */
  reveal(uri: FileUri, range: { start: { line: number; column: number }; end: { line: number; column: number } }): Promise<void>
  /** Saves a file. A conflict shows in its editor. */
  save(uri: FileUri): Promise<void>
  /** Closes a file, asking first when it has unsaved edits. */
  close(uri: FileUri): Promise<void>
  /** Asks about unsaved edits before `panel` (default the file's main editor) closes. Resolves true when it may. */
  confirmClose(uri: FileUri, panel?: string): boolean | Promise<boolean>
  overwrite(uri: FileUri): Promise<void>
  reload(uri: FileUri): Promise<void>
  /** Moves a file into a managed window. Undefined outside a window manager. */
  openInWindow?: (uri: FileUri) => Promise<void>
  /** Moves a windowed file back to a tab. */
  moveToTab(uri: FileUri): void
  /** Compares a file with what was last saved. */
  showChanges(uri: FileUri): void
  /** Opens a second editor of a file beside the first, on the same document. */
  splitEditor(uri: FileUri): void
  /** Goes to where the symbol at the caret is defined, through `backend.definition`. */
  goToDefinition(uri: FileUri): Promise<void>
  /** Asks for a new name for the symbol at the caret, then renames it through `backend.rename`. */
  renameSymbol(uri: FileUri): Promise<void>
  /** Formats a file through `backend.format`, or the built-in formatter for its language. */
  format(uri: FileUri): Promise<void>
  /** Shows a panel by id: "problems", "output" or one of the application's. */
  showPanel(id: string): void
  /** Hides or shows the area under the editors. */
  togglePanels(): void
  /** Opens the Open dialog, the New file dialog, or Save as for a file. */
  fileDialog(request: { mode: "open" } | { mode: "new" } | { mode: "saveAs"; uri: FileUri }): void
  /** Opens the keyboard shortcuts. */
  showShortcuts(): void
  /** Opens the appearance settings. */
  showAppearance(): void
  /** Opens the command palette, with the project's files listed. */
  quickOpen(): void
}

export const WorkbenchContext = /* @__PURE__ */ createContext<WorkbenchContextValue | null>(null)

/** The arrangement `EditorArea` draws. Apart from the rest, so moving a tab re-renders only that. */
export interface WorkbenchLayoutValue {
  layout: PaneLayoutState
  onLayoutChange(layout: PaneLayoutState): void
}

export const WorkbenchLayoutContext = /* @__PURE__ */ createContext<WorkbenchLayoutValue | null>(null)

/** The workbench around a component: what is open, and the operations on it. */
export function useWorkbench(): WorkbenchContextValue {
  const value = use(WorkbenchContext)
  if (!value) throw new Error("useWorkbench needs a Workbench or WorkbenchProvider above it.")
  return value
}
