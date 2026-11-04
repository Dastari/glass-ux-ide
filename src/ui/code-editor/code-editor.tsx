import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { Field, type FieldProps } from "glass-ux/field"
import type { DocumentHandle } from "../../core/handle.ts"
import type { Lexer } from "../../core/lexer.ts"
import { tierOf } from "../../core/tiers.ts"
import { createTextHandle } from "../../react/text-handle.ts"
import { useEditorView } from "../../react/use-editor-view.ts"
import type { EditorStatus, EditorView } from "../../view/index.ts"
import "../../view/editor.css"
import "./code-editor.css"

/** What `ref` gives on {@link CodeEditor}. */
export interface CodeEditorHandle {
  /** The editor surface, once it has mounted. */
  readonly view: EditorView | null
  focus(): void
}

/** Props of {@link CodeEditor}. */
export interface CodeEditorProps {
  /** Names the editor for assistive technology. */
  "aria-label": string
  /** A document of any size, from `openFile` or `connectDocument`. Takes priority over `value`. */
  document?: DocumentHandle
  /** Controlled text, for short content. A large file belongs in a `document`. */
  value?: string
  /** The initial text when uncontrolled. */
  defaultValue?: string
  /** Called with the text after an edit. Not called for a `document`. */
  onValueChange?: (value: string) => void
  /** Highlighting rules, such as `typescriptLexer`. */
  lexer?: Lexer
  /** Keeps navigation, selection and copy, and refuses edits. */
  readOnly?: boolean
  /** Marks the content as failing validation. */
  invalid?: boolean
  /** The id of an element describing the editor. */
  describedBy?: string
  /** Reports the caret, the size tier and the line numbers' exactness. */
  onStatus?: (status: EditorStatus) => void
  /** Mirror the current line into the input, for screen readers. */
  screenReader?: boolean
  className?: string
  ref?: Ref<CodeEditorHandle>
}

/**
 * Edits a document of any size in a bounded box. Give the parent a definite height (R7.3).
 * Use `document` for files, and `value` or `defaultValue` for short content.
 */
export function CodeEditor({ "aria-label": label, document, value, defaultValue = "", onValueChange, lexer, readOnly, invalid, describedBy, onStatus, screenReader, className, ref }: CodeEditorProps) {
  const mount = useRef<HTMLDivElement>(null)
  const [owned] = useState(() => (document ? null : createTextHandle(value ?? defaultValue)))
  const handle = document ?? owned
  const lastEmitted = useRef(value ?? defaultValue)
  const notify = useRef(onValueChange)
  notify.current = onValueChange

  const view = useEditorView(mount, handle, {
    ariaLabel: label,
    lexer,
    readOnly,
    screenReader,
    ariaInvalid: invalid,
    ariaDescribedBy: describedBy,
    onStatus,
    onChange: (state) => {
      if (document || !handle) return
      if (import.meta.env?.DEV && tierOf(state.size) > 0) console.warn("CodeEditor: `value` is for short text. Open a file this size as a `document`.")
      if (!notify.current) return
      void handle.text(0, state.size).then((text) => {
        lastEmitted.current = text
        notify.current?.(text)
      })
    },
  })

  useEffect(() => {
    if (value === undefined || document || value === lastEmitted.current) return
    lastEmitted.current = value
    void view?.setText(value)
  }, [document, value, view])

  useImperativeHandle(ref, () => ({ view, focus: () => view?.focus() }), [view])

  return <div ref={mount} className={["gux-code-editor", className].filter(Boolean).join(" ")} />
}

/** Props of {@link CodeViewer}. */
export type CodeViewerProps = Omit<CodeEditorProps, "readOnly" | "onValueChange" | "defaultValue" | "invalid">

/** Shows code of any size, with the same scrolling and highlighting, and no editing. */
export function CodeViewer(props: CodeViewerProps) {
  return <CodeEditor {...props} readOnly />
}

/** Props of {@link CodeField}. */
export interface CodeFieldProps extends Pick<FieldProps, "label" | "hint" | "error" | "warning" | "optional" | "required" | "aside" | "message" | "className"> {
  /** Controlled text. */
  value?: string
  /** The initial text when uncontrolled. */
  defaultValue?: string
  /** Called with the text after an edit. */
  onValueChange?: (value: string) => void
  /** Called when focus leaves, for a form's validate-on-blur (R15.9). */
  onBlur?: () => void
  /** Highlighting rules, such as `typescriptLexer`. */
  lexer?: Lexer
  /** Keeps navigation, selection and copy, and refuses edits. */
  readOnly?: boolean
  /** The editor's height. Default 11rem. */
  height?: string
}

const toLabel = (label: FieldProps["label"]) => (typeof label === "string" ? label : "Code")

/**
 * Code in a form: a `Field` holding an editor, so it has a label, a hint and an error like any other
 * control, and works with `useAppForm` through `value`, `onValueChange` and `onBlur`.
 */
export function CodeField({ label, hint, error, warning, optional, required, aside, message, className, value, defaultValue, onValueChange, onBlur, lexer, readOnly, height = "11rem" }: CodeFieldProps) { // tokens:allow a prop value, and rem follows UI scale
  const editor = useRef<CodeEditorHandle>(null)
  const box = useMemo(() => ({ blockSize: height }), [height])
  return (
    <Field label={label} nativeLabel={false} hint={hint} error={error} warning={warning} optional={optional} required={required} aside={aside} message={message} className={className}>
      <div className="gux-code-field" style={box} data-invalid={error ? "" : undefined} onClick={() => editor.current?.focus()} onBlur={onBlur}>
        <CodeEditor ref={editor} aria-label={toLabel(label)} value={value} defaultValue={defaultValue} onValueChange={onValueChange} lexer={lexer} readOnly={readOnly} invalid={Boolean(error)} />
      </div>
    </Field>
  )
}
