import { useSyncExternalStore } from "react"
import { formatBytes } from "glass-ux/byte-size-field"
import { useMessages } from "glass-ux/i18n"
import { ShortcutPending } from "glass-ux/keymap"
import { useLocale } from "glass-ux/locale"
import { StatusBar } from "glass-ux/status-bar"
import { useWorkbench } from "./context.ts"
import { workbenchMessages } from "./messages.ts"
import "./workbench.css"

/** A size in the reader's language, such as 100 GB, as glass-ux writes sizes everywhere. */
export function formatSize(bytes: number, locale: string) {
  return formatBytes(bytes, { locale })
}

/** The bar under a workbench: problems, the caret, the file's size and any shortcut in progress. */
export function WorkbenchStatusBar({ className }: { className?: string }) {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const locale = useLocale()
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const active = workbench.activeUri ? records.find((item) => item.uri === workbench.activeUri) : undefined
  const errors = records.reduce((sum, record) => sum + record.diagnostics.filter((item) => item.severity === "error").length, 0)
  const warnings = records.reduce((sum, record) => sum + record.diagnostics.filter((item) => item.severity === "warning").length, 0)
  const status = active?.status
  const readOnly = active && !active.provider.write && !active.provider.applyEdits
  const showProblems = () => workbench.showPanel("problems")
  return (
    <StatusBar aria-label={messages.editor} className={className}>
      <StatusBar.Start>
        {workbench.backend.diagnostics ? <StatusBar.Item onClick={showProblems} tone={errors ? "danger" : undefined}>{messages.errors({ count: errors, locale })}</StatusBar.Item> : null}
        {workbench.backend.diagnostics ? <StatusBar.Item giveWay={2} onClick={showProblems}>{messages.warnings({ count: warnings, locale })}</StatusBar.Item> : null}
      </StatusBar.Start>
      <StatusBar.End>
        <ShortcutPending />
        {status ? <StatusBar.Item>{messages.line({ line: (status.line + 1).toLocaleString(locale), column: (status.column + 1).toLocaleString(locale), exact: status.exactLines })}</StatusBar.Item> : null}
        {status && status.selections > 1 ? <StatusBar.Item>{messages.carets({ count: status.selections.toLocaleString(locale) })}</StatusBar.Item> : null}
        {readOnly ? <StatusBar.Item giveWay={2}>{messages.readOnly}</StatusBar.Item> : null}
        {typeof active?.opened.stat.size === "number" ? <StatusBar.Item giveWay={1}>{formatSize(active.opened.stat.size, locale)}</StatusBar.Item> : null}
      </StatusBar.End>
    </StatusBar>
  )
}
