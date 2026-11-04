import { createContext, use, useCallback, useMemo } from "react"
import type { FileUri } from "glass-ux/file-provider"
import { usePaletteCommands, type PaletteCommand } from "glass-ux/command-palette"
import { useMessages } from "glass-ux/i18n"
import { useShortcutCommands, type ShortcutCommand } from "glass-ux/keymap"
import { createElement } from "react"
import { FileIcon } from "glass-ux/file-icon"
import type { WorkbenchContextValue } from "./context.ts"
import { workbenchMessages } from "./messages.ts"
import type { OpenRecord } from "./store.ts"

/** One thing a workbench can do: its shortcut, palette entry and menu row share this. */
export interface WorkbenchCommand {
  id: string
  label: string
  group: string
  keys?: string
  /** Why it cannot run now. */
  disabledReason?: string | null
  /** Checked on each key press: false leaves the key to whatever has focus. */
  when?: () => boolean
  run(): void
}

/** Whether focus is in an editor, where keys such as F2 mean the code and not the file tree. */
const inEditor = () => typeof document !== "undefined" && Boolean(document.activeElement?.closest(".gux-editor"))

export const WorkbenchCommandsContext = /* @__PURE__ */ createContext<readonly WorkbenchCommand[]>([])

/** Every command of the workbench around a component, for building menus of your own. */
export function useWorkbenchCommands() {
  return use(WorkbenchCommandsContext)
}

/** Defines the commands and gives them to the keymap and the palette. */
export function useWorkbenchCommandList(workbench: WorkbenchContextValue, records: readonly OpenRecord[], projectFiles: readonly FileUri[]) {
  const messages = useMessages(workbenchMessages)
  const { activeUri, backend, findRequests, store } = workbench
  const active = activeUri ? records.find((item) => item.uri === activeUri) : undefined
  const editable = Boolean(active && (active.provider.write || active.provider.applyEdits))
  const canCreate = (backend.files ?? []).some((item) => item.write)
  const noFile = active ? null : messages.noFile
  const notEditable = noFile ?? (editable ? null : messages.readOnly)
  const notCreatable = canCreate ? null : messages.readOnly
  const windowed = active?.windowed ?? false

  const commands = useMemo<WorkbenchCommand[]>(() => {
    const list: WorkbenchCommand[] = [
      { id: "file.new", label: messages.newFile, group: messages.file, keys: "mod+alt+n", disabledReason: notCreatable, run: () => workbench.fileDialog({ mode: "new" }) },
      { id: "file.open", label: messages.openFile, group: messages.file, keys: "mod+o", run: () => workbench.fileDialog({ mode: "open" }) },
      { id: "file.save", label: messages.save, group: messages.file, keys: "mod+s", disabledReason: notEditable, run: () => activeUri && void workbench.save(activeUri) },
      { id: "file.saveAs", label: messages.saveAs, group: messages.file, keys: "mod+shift+s", disabledReason: noFile ?? notCreatable, run: () => activeUri && workbench.fileDialog({ mode: "saveAs", uri: activeUri }) },
      { id: "file.close", label: messages.closeEditor, group: messages.file, keys: "mod+alt+w", disabledReason: noFile, run: () => activeUri && void workbench.close(activeUri) },
      { id: "editor.undo", label: messages.undo, group: messages.edit, keys: "mod+z", disabledReason: noFile, run: () => void store.get(activeUri ?? "")?.view?.undo() },
      { id: "editor.redo", label: messages.redo, group: messages.edit, keys: "mod+shift+z", disabledReason: noFile, run: () => void store.get(activeUri ?? "")?.view?.redo() },
      { id: "editor.find", label: messages.find, group: messages.edit, keys: "mod+f", disabledReason: noFile, run: () => activeUri && findRequests.open(activeUri) },
      { id: "editor.format", label: messages.format, group: messages.edit, keys: "shift+alt+f", disabledReason: notEditable, run: () => activeUri && void workbench.format(activeUri) },
      { id: "editor.definition", label: messages.goToDefinition, group: messages.go, keys: "f12", disabledReason: noFile ?? (backend.definition ? null : messages.notProvided), when: inEditor, run: () => activeUri && void workbench.goToDefinition(activeUri) },
      { id: "editor.rename", label: messages.renameSymbol, group: messages.edit, keys: "f2", disabledReason: notEditable ?? (backend.rename ? null : messages.notProvided), when: inEditor, run: () => activeUri && void workbench.renameSymbol(activeUri) },
      { id: "editor.hover", label: messages.showHover, group: messages.view, keys: "mod+k mod+i", disabledReason: noFile ?? (backend.hover ? null : messages.notProvided), run: () => activeUri && findRequests.open(activeUri, "hover") },
      { id: "editor.split", label: messages.splitEditor, group: messages.view, keys: "mod+\\", disabledReason: noFile ?? (windowed ? messages.inWindow : null), run: () => activeUri && workbench.splitEditor(activeUri) },
      { id: "editor.changes", label: messages.compareWithSaved, group: messages.edit, disabledReason: noFile, run: () => activeUri && workbench.showChanges(activeUri) },
      { id: "workbench.commands", label: messages.commandPalette, group: messages.view, keys: "mod+shift+p", run: () => workbench.quickOpen() },
      { id: "workbench.quickOpen", label: messages.quickOpen, group: messages.view, keys: "mod+p", run: () => workbench.quickOpen() },
      { id: "workbench.panels", label: messages.togglePanels, group: messages.view, keys: "mod+j", run: () => workbench.togglePanels() },
      { id: "workbench.problems", label: messages.problems, group: messages.view, keys: "mod+shift+m", run: () => workbench.showPanel("problems") },
      { id: "workbench.output", label: messages.output, group: messages.view, run: () => workbench.showPanel("output") },
      { id: "workbench.appearance", label: messages.appearance, group: messages.view, run: () => workbench.showAppearance() },
      { id: "workbench.shortcuts", label: messages.shortcuts, group: messages.help, keys: "mod+k mod+s", run: () => workbench.showShortcuts() },
    ]
    if (workbench.openInWindow) {
      list.push(windowed
        ? { id: "window.toTab", label: messages.moveToTab, group: messages.windowMenu, disabledReason: noFile, run: () => activeUri && workbench.moveToTab(activeUri) }
        : { id: "window.open", label: messages.openInWindow, group: messages.windowMenu, disabledReason: noFile, run: () => activeUri && void workbench.openInWindow?.(activeUri) })
    }
    return list
  }, [activeUri, findRequests, messages, noFile, notCreatable, notEditable, store, windowed, workbench])

  useShortcutCommands(useMemo(() => commands.map((item) => ({ ...item, textEntry: "inputs" as const })), [commands]) as readonly ShortcutCommand[])

  const icon = useCallback((uri: FileUri) => createElement(FileIcon, { name: uri }), [])
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const open = new Set(records.map((record) => record.uri))
    const toFile = (uri: FileUri): PaletteCommand => ({ id: `go:${uri}`, label: workbench.nameOf(uri), detail: uri, group: messages.files, icon: icon(uri), run: () => void workbench.open(uri) })
    return [
      ...commands.filter((item) => !item.id.startsWith("workbench.commands") && !item.id.startsWith("workbench.quickOpen") && !item.disabledReason).map((item) => ({ id: item.id, label: item.label, group: item.group, shortcut: item.keys, run: item.run })),
      ...records.map((record) => toFile(record.uri)),
      ...projectFiles.filter((uri) => !open.has(uri)).map(toFile),
    ]
  }, [commands, icon, messages, projectFiles, records, workbench])
  usePaletteCommands(paletteCommands)

  return commands
}
