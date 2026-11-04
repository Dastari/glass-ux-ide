import { useEffect, useRef, useState, type RefObject } from "react"
import type { DocumentHandle } from "../core/handle.ts"
import { EditorView, type EditorViewOptions } from "../view/index.ts"

export type EditorViewProps = Omit<EditorViewOptions, "handle">

/**
 * Mounts an EditorView in an element for as long as the handle stays the same. Callbacks are read
 * through a ref, so a new closure on each render does not rebuild the editor, which would lose its
 * caret and scroll.
 */
export function useEditorView(mount: RefObject<HTMLElement | null>, handle: DocumentHandle | null, props: EditorViewProps): EditorView | null {
  const [view, setView] = useState<EditorView | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const element = mount.current
    if (!element || !handle) return
    const created = new EditorView(element, {
      handle,
      ariaLabel: latest.current.ariaLabel,
      lexer: latest.current.lexer,
      readOnly: latest.current.readOnly,
      screenReader: latest.current.screenReader,
      rowBytes: latest.current.rowBytes,
      ariaInvalid: latest.current.ariaInvalid,
      ariaDescribedBy: latest.current.ariaDescribedBy,
      onStatus: (status) => latest.current.onStatus?.(status),
      onChange: (state) => latest.current.onChange?.(state),
      onKey: (event) => latest.current.onKey?.(event) ?? false,
      onTyped: (text) => latest.current.onTyped?.(text),
      onSelection: () => latest.current.onSelection?.(),
    })
    setView(created)
    return () => {
      created.dispose()
      setView(null)
    }
  }, [handle, mount])

  useEffect(() => {
    view?.setReadOnly(Boolean(props.readOnly))
  }, [props.readOnly, view])

  return view
}
