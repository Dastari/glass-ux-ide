import { useEffect, useRef, useSyncExternalStore } from "react"
import { Button } from "glass-ux/button"
import type { FileUri } from "glass-ux/file-provider"
import { useMessages } from "glass-ux/i18n"
import { IconFile, IconSave, IconSidebar } from "glass-ux/icons"
import { Spinner } from "glass-ux/spinner"
import { Window, WindowBodySkeleton, type OpenWindowInput, type WindowContentProps, type WindowEntry, type WindowKindDefinition } from "glass-ux/windows"
import { useLocale } from "glass-ux/locale"
import { useWorkbench } from "./context.ts"
import { OpenEditor } from "./editor-panel.tsx"
import { workbenchMessages } from "./messages.ts"
import { isDirty } from "./store.ts"

const KIND = "glass-ux-ide.code"
const nameOf = (uri: string) => decodeURIComponent(uri.split("/").pop() ?? uri)

interface CodeWindowParams extends Record<string, string> {
  uri: FileUri
}

/** One file's editor in a managed window. The window closes through the same guard as a tab. */
function CodeWindowBody({ params }: WindowContentProps<CodeWindowParams>) {
  const workbench = useWorkbench()
  const messages = useMessages(workbenchMessages)
  const locale = useLocale()
  const { uri } = params
  const records = useSyncExternalStore(workbench.store.subscribe, workbench.store.getSnapshot)
  const record = records.find((item) => item.uri === uri)
  const latest = useRef(workbench)
  latest.current = workbench

  // A window restored from storage arrives before anything has opened its file.
  useEffect(() => {
    const { store, backend } = latest.current
    if (store.get(uri)) return
    const provider = backend.files?.find((item) => uri.startsWith(`${item.scheme}:`))
    if (provider) void store.open(provider, uri, false).then(() => store.patch(uri, { windowed: true }))
  }, [uri])


  if (!record) return <WindowBodySkeleton />
  const dirty = isDirty(record)
  const status = record.status
  return (
    <>
      <Window.Actions>
        <Window.Action label={messages.save} icon={<IconSave />} priority="primary" onSelect={() => void workbench.save(uri)} disabled={!dirty}>
          <Button variant="ghost" size="sm" icon={<IconSave />} aria-label={messages.save} tooltip={messages.save} disabled={!dirty} onClick={() => void workbench.save(uri)} />
        </Window.Action>
        <Window.Action label={messages.moveToTab} icon={<IconSidebar />} onSelect={() => workbench.moveToTab(uri)}>
          <Button variant="ghost" size="sm" icon={<IconSidebar />} aria-label={messages.moveToTab} tooltip={messages.moveToTab} onClick={() => workbench.moveToTab(uri)} />
        </Window.Action>
      </Window.Actions>
      <Window.Body variant="fill">
        <OpenEditor record={record} />
      </Window.Body>
      <Window.Status indicator={dirty ? { tone: "warning", label: messages.unsaved } : undefined}>
        {status ? <Window.StatusItem>{messages.line({ line: (status.line + 1).toLocaleString(locale), column: (status.column + 1).toLocaleString(locale), exact: status.exactLines })}</Window.StatusItem> : <Spinner />}
        {dirty ? <Window.StatusMeta>{messages.unsaved}</Window.StatusMeta> : null}
      </Window.Status>
    </>
  )
}

/** The window kind that shows a file. The workbench registers it. */
export const codeWindowKind: WindowKindDefinition<CodeWindowParams> = {
  kind: KIND,
  title: ({ uri }) => nameOf(uri),
  subtitle: ({ uri }) => uri,
  icon: IconFile,
  key: ({ uri }) => `${KIND}:${uri}`,
  size: { w: 720, h: 480 },
  minSize: { w: 360, h: 240 },
  // A popup is another page, so it has none of this one's documents or its keymap.
  popout: false,
  load: async () => ({ default: CodeWindowBody }),
}

/** The id of a file's window. */
export const codeWindowId = (uri: FileUri) => `${KIND}:${uri}`

/** What to give `WindowManager.open` for a file. A second open brings the first forward. */
export const codeWindowInput = (uri: FileUri): OpenWindowInput => ({ kind: KIND, params: { uri }, layout: "floating" })

/** The file a window shows, when it is a code window. */
export const codeWindowUri = (entry: Pick<WindowEntry, "kind" | "params">) => (entry.kind === KIND ? String(entry.params.uri) : null)
