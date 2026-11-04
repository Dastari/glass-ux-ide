import { useMemo } from "react"
import { useMessages } from "glass-ux/i18n"
import { Menubar, type MenubarMenu } from "glass-ux/menubar"
import { useWorkbenchCommands, type WorkbenchCommand } from "./commands.ts"
import { workbenchMessages } from "./messages.ts"

/** Props of {@link WorkbenchMenubar}. */
export interface WorkbenchMenubarProps {
  /** Commands of your own, shown at the end of the View menu. */
  viewCommands?: readonly WorkbenchCommand[]
  className?: string
}

/** The workbench's menus, built from its commands, so a menu row, a shortcut and the palette always agree. */
export function WorkbenchMenubar({ viewCommands = [], className }: WorkbenchMenubarProps) {
  const messages = useMessages(workbenchMessages)
  const commands = useWorkbenchCommands()
  const menus = useMemo<MenubarMenu[]>(() => {
    const row = (id: string) => {
      const command = commands.find((item) => item.id === id) ?? viewCommands.find((item) => item.id === id)
      return command ? [{ id, label: command.label, commandId: id, disabledReason: command.disabledReason ?? undefined, onSelect: () => void command.run() }] : []
    }
    const gap = (id: string) => [{ kind: "separator" as const, id }]
    return [
      { id: "file", label: messages.file, items: [...row("file.new"), ...row("file.open"), ...gap("file-1"), ...row("file.save"), ...row("file.saveAs"), ...gap("file-2"), ...row("file.close")] },
      { id: "edit", label: messages.edit, items: [...row("editor.undo"), ...row("editor.redo"), ...gap("edit-1"), ...row("editor.find"), ...row("editor.format"), ...row("editor.rename"), ...gap("edit-2"), ...row("editor.changes")] },
      {
        id: "view",
        label: messages.view,
        items: [
          ...row("workbench.commands"),
          ...row("workbench.quickOpen"),
          ...(viewCommands.length ? gap("view-1") : []),
          ...viewCommands.flatMap((item) => row(item.id)),
          ...gap("view-2"),
          ...row("workbench.problems"),
          ...row("workbench.output"),
          ...row("workbench.panels"),
          ...row("editor.split"),
          ...gap("view-3"),
          ...row("workbench.appearance"),
        ],
      },
      { id: "go", label: messages.go, items: [...row("workbench.quickOpen"), ...row("editor.definition"), ...row("editor.hover")] },
      ...(commands.some((item) => item.id.startsWith("window.")) ? [{ id: "window", label: messages.windowMenu, items: [...row("window.open"), ...row("window.toTab")] }] : []),
      { id: "help", label: messages.help, items: row("workbench.shortcuts") },
    ]
  }, [commands, messages, viewCommands])
  return <Menubar aria-label={messages.menus} menus={menus} className={className} />
}
