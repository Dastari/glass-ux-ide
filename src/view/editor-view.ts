/**
 * EditorView: the text on screen, without React.
 *
 * It keeps a small pool of row elements and writes them directly, so its cost depends on the
 * viewport and never on the document. The document may be in a worker: everything here works from
 * byte offsets and a handful of cached rows. A typed character is painted in the same frame and
 * the edit follows, so typing never waits on a round trip.
 */
import { utf8Length, utf16Length } from "../core/encoding.ts"
import type { TextRow } from "../core/document.ts"
import type { DocumentHandle, DocumentState } from "../core/handle.ts"
import type { ByteEdit } from "../core/types.ts"
import type { Lexer } from "../core/lexer.ts"

/** A selection in byte offsets. `head` is where the caret is; an empty one has anchor === head. */
export interface Selection {
  anchor: number
  head: number
}

export interface EditorStatus {
  line: number
  column: number
  exactLines: boolean
  offset: number
  size: number
  tier: number
  selections: number
  /** Whether there is anything to undo, which is how a tab knows to show as unsaved. */
  canUndo: boolean
}

/** A problem drawn under the text, in byte offsets. */
export interface EditorMark {
  start: number
  end: number
  severity: "error" | "warning" | "info"
  message: string
}

export interface EditorViewOptions {
  handle: DocumentHandle
  ariaLabel: string
  lexer?: Lexer
  readOnly?: boolean
  /** Says why text cannot be edited, for an input's description. */
  ariaInvalid?: boolean
  /** Ids of elements that describe the editor, such as a field's hint or error. */
  ariaDescribedBy?: string
  /** Called after each edit has landed in the document. */
  onChange?: (state: DocumentState) => void
  /** Sees a key first. Return true to take it, as an open suggestion list takes the arrows. */
  onKey?: (event: KeyboardEvent) => boolean
  /** Called when text was typed, so a host can open or update suggestions. */
  onTyped?: (text: string) => void
  /** Called when the caret moved or selection changed. */
  onSelection?: () => void
  /** Mirror the current lines into the input, so a screen reader can read them. */
  screenReader?: boolean
  /** The longest row in bytes. Longer lines become several rows. */
  rowBytes?: number
  onStatus?: (status: EditorStatus) => void
}

const CAPPED_HEIGHT = 8_000_000
/**
 * Pixels the scrollbar stays from each end unless the text really is at that end. At 100 GB one
 * pixel is about 100 lines, so without this a few rows' scroll rounds the bar to the very top,
 * and the browser then has nowhere to scroll up to.
 */
const SCROLL_MARGIN = 4000
const OVERSCAN = 12
const TAB = "  "
const STATE_CONTEXT_BYTES = 128 * 1024
const encoder = new TextEncoder()
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const words = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null

const element = (name: string, className?: string) => {
  const node = document.createElement(name)
  if (className) node.className = className
  return node
}

/**
 * The editing surface as a plain DOM object, for use from any framework. In React, use `CodeEditor`.
 * It mounts into `parent` and reads through a `DocumentHandle`, so the document can be in a worker.
 */
export class EditorView {
  /** The element the editor mounted. */
  readonly root: HTMLElement
  /** Where the text goes: keyboard input, IME and screen readers all use this element. */
  readonly input: HTMLTextAreaElement

  private readonly options: EditorViewOptions
  private readonly handle: DocumentHandle
  private readonly rowBytes: number
  private readonly scroller = element("div", "gux-scroller")
  private readonly spacer = element("div", "gux-spacer")
  private readonly viewport = element("div", "gux-viewport")
  private readonly gutter = element("div", "gux-layer gux-gutter")
  private readonly content = element("div", "gux-layer gux-content")
  private readonly selectionLayer = element("div", "gux-selection-layer")
  private readonly caretLayer = element("div", "gux-caret-layer")
  private readonly rowsLayer = element("div")
  private readonly observer: ResizeObserver

  private rowElements: HTMLElement[] = []
  private gutterElements: HTMLElement[] = []
  private state: DocumentState | null = null
  private rows: TextRow[] = []
  private lineHeight = 22
  private charWidth = 8
  private viewportRows = 0

  /** The first row on screen. */
  private top = 0
  /** Line number of `top`, when lines are exact or estimated. */
  private topLine = 0
  private anchor = { scrollTop: 0, offset: 0, rows: 0 }
  private selections: Selection[] = [{ anchor: 0, head: 0 }]
  private desiredColumn: number | null = null
  private generation = 0
  /** The caret before the edit being made, and around each history step, for undo and redo. */
  private caretBeforeEdit: Selection[] | null = null
  private readonly caretBefore = new Map<number, Selection[]>()
  private readonly caretAfter = new Map<number, Selection[]>()
  private frame = 0
  private ignoreScroll = false
  private dragging = false
  private composing = false
  private inputValue = ""
  private tabMovesFocus = false
  private disposed = false
  private lexStates = new Map<number, number>()
  private matchPattern: RegExp | null = null
  private marks: readonly EditorMark[] = []
  private rowRetries = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  /** Commands still running. Input arrives faster than async moves finish, and must keep its order. */
  private commands = 0
  private tail: Promise<void> = Promise.resolve()
  /** Edits sent but not yet applied. Rows read meanwhile are out of date, so they are dropped. */
  private pendingEdits = 0
  private scrolling = false
  private scrollAgain = false

  constructor(parent: HTMLElement, options: EditorViewOptions) {
    this.options = options
    this.handle = options.handle
    this.rowBytes = options.rowBytes ?? 4 * 1024
    this.root = element("div", "gux-editor")
    this.root.dir = "ltr"
    this.input = element("textarea", "gux-input") as HTMLTextAreaElement
    this.input.setAttribute("aria-label", options.ariaLabel)
    this.input.setAttribute("aria-multiline", "true")
    if (options.ariaInvalid) this.input.setAttribute("aria-invalid", "true")
    if (options.ariaDescribedBy) this.input.setAttribute("aria-describedby", options.ariaDescribedBy)
    this.input.setAttribute("autocapitalize", "off")
    this.input.setAttribute("autocomplete", "off")
    this.input.setAttribute("autocorrect", "off")
    this.input.spellcheck = false
    this.input.readOnly = Boolean(options.readOnly)
    this.gutter.setAttribute("aria-hidden", "true")
    this.content.setAttribute("aria-hidden", "true")

    this.content.append(this.selectionLayer, this.rowsLayer, this.caretLayer)
    this.viewport.append(this.gutter, this.content, this.input)
    this.spacer.append(this.viewport)
    this.scroller.append(this.spacer)
    this.root.append(this.scroller)
    parent.append(this.root)

    this.scroller.addEventListener("scroll", this.onScroll, { passive: true })
    this.content.addEventListener("pointerdown", this.onPointerDown)
    this.input.addEventListener("keydown", this.onKeyDown)
    this.input.addEventListener("input", this.onInput)
    this.input.addEventListener("compositionstart", this.onCompositionStart)
    this.input.addEventListener("compositionend", this.onCompositionEnd)
    this.input.addEventListener("copy", this.onCopy)
    this.input.addEventListener("cut", this.onCut)
    this.input.addEventListener("paste", this.onPaste)

    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.root)
    this.handle.onIndexed(() => void this.refresh())
    this.measure()
    this.layout()
    void this.refresh()
  }

  /** Current selections, in byte offsets. */
  get selection(): readonly Selection[] {
    return this.selections
  }

  /** The rows currently held, for tests and tooling. */
  get visibleRows(): readonly TextRow[] {
    return this.rows
  }

  focus() {
    this.input.focus({ preventScroll: true })
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    clearTimeout(this.idleTimer)
    this.observer.disconnect()
    this.root.remove()
  }

  /** Sets the selection, scrolling it into view. */
  async select(selections: readonly Selection[]) {
    this.selections = selections.map((item) => ({ ...item }))
    this.desiredColumn = null
    await this.reveal(this.selections[0]!.head)
  }

  /** Scrolls so an offset is on screen. */
  async reveal(offset: number) {
    if (this.rowIndexOf(offset) >= 0 && this.rowIndexOf(offset) < this.viewportRows) {
      this.paintDecorations()
      this.report()
      return
    }
    const start = await this.rowStartOf(offset)
    await this.jump(start)
  }

  /** The word characters just before the caret, and where they start. */
  async wordBeforeCaret(): Promise<{ start: number; text: string }> {
    const head = this.selections[0]!.head
    const row = await this.rowAt(head)
    const before = row.text.slice(0, this.columnIn(row, head))
    const text = /[\p{L}\p{N}_$]*$/u.exec(before)![0]
    return { start: head - utf8Length(text), text }
  }

  /** The caret's rectangle on screen, for anchoring a popup. Null when it is off screen. */
  caretRect(): DOMRect | null {
    return this.rectAt(this.selections[0]!.head)
  }

  /** The rectangle of the character at a byte offset, on screen. Null when it is not shown. */
  rectAt(offset: number): DOMRect | null {
    const index = this.rowIndexOf(offset)
    const row = this.rows[index]
    if (!row || index >= this.viewportRows || offset < row.start || offset > row.end) return null
    const box = this.rowElements[index]!.getBoundingClientRect()
    const x = this.xOf(index, this.columnIn(row, offset))
    return new DOMRect(box.left + x, box.top, 1, this.lineHeight)
  }

  /** The byte offset under a point on screen, or null when the point is not over the text. */
  offsetAtPoint(x: number, y: number): number | null {
    const box = this.rowsLayer.getBoundingClientRect()
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null
    const index = Math.floor((y - box.top) / this.lineHeight)
    if (!this.rows[index]) return null
    return this.offsetFromPoint(x, y)
  }

  /** Replaces a byte range and puts the caret after it. */
  replaceRange(start: number, end: number, text: string, group?: string) {
    this.selections = [{ anchor: start, head: end }]
    this.command(() => this.insert(text, group))
  }

  /** Replaces all the text, for a controlled value. The caret stays where it fits. */
  async setText(text: string) {
    const state = await this.handle.state()
    this.state = await this.handle.edit([{ start: 0, end: state.size, text }])
    const head = Math.min(this.selections[0]!.head, this.state.size)
    this.selections = [{ anchor: head, head }]
    this.setExtent()
    this.lexStates.clear()
    await this.loadRows()
  }

  /** Marks every match of a pattern on screen, or none. */
  setMatches(pattern: RegExp | null) {
    this.matchPattern = pattern ? new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`) : null
    this.paintDecorations()
  }

  /** Draws problems under the text. */
  setMarks(marks: readonly EditorMark[]) {
    this.marks = marks
    this.paintDecorations()
  }

  setReadOnly(readOnly: boolean) {
    this.options.readOnly = readOnly
    this.input.readOnly = readOnly
  }

  /** Re-reads the document's state and the rows on screen. */
  async refresh() {
    this.state = await this.handle.state()
    this.setExtent()
    await this.loadRows()
  }

  /**
   * Runs a command in order. With nothing queued it starts at once, in this very event, which is
   * what lets a keystroke paint in the same frame.
   */
  private command(work: () => Promise<void> | void) {
    const finish = () => {
      this.commands -= 1
    }
    if (this.commands === 0) {
      this.commands = 1
      const result = work()
      if (result) this.tail = result.catch(() => undefined).then(finish)
      else finish()
      return
    }
    this.commands += 1
    this.tail = this.tail.then(async () => {
      await work()
    }).catch(() => undefined).then(finish)
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  private measure() {
    const probe = element("span")
    probe.textContent = "0".repeat(100)
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre"
    this.root.append(probe)
    const box = probe.getBoundingClientRect()
    if (box.width) this.charWidth = box.width / 100
    probe.remove()
    const line = parseFloat(getComputedStyle(this.root).lineHeight)
    if (line) this.lineHeight = line
  }

  private layout() {
    const { clientHeight, clientWidth } = this.scroller
    // A hidden tab has no size. Its rows stay as they are until it is shown again.
    if (clientHeight === 0) return
    this.viewport.style.blockSize = `${clientHeight}px`
    this.viewport.style.inlineSize = `${clientWidth}px`
    const wanted = Math.ceil(clientHeight / this.lineHeight) + 1
    if (wanted !== this.viewportRows) {
      this.viewportRows = wanted
      this.ensurePool()
      void this.loadRows()
    }
    this.setExtent()
  }

  private ensurePool() {
    while (this.rowElements.length < this.viewportRows) {
      const row = element("div", "gux-row")
      const number = element("div")
      this.rowElements.push(row)
      this.gutterElements.push(number)
      this.rowsLayer.append(row)
      this.gutter.append(number)
    }
  }

  /** Line mode maps one line to one row height. Otherwise position is a fraction of the bytes. */
  private get lineMode() {
    const state = this.state
    if (!state?.exactLines) return false
    return state.lineCount * this.lineHeight <= CAPPED_HEIGHT && state.size / state.lineCount < this.rowBytes / 4
  }

  private setExtent() {
    const state = this.state
    if (!state) return
    const height = this.lineMode ? (state.lineCount + 1) * this.lineHeight : CAPPED_HEIGHT
    this.spacer.style.blockSize = `${height}px`
  }

  private get scrollRange() {
    return Math.max(1, this.scroller.scrollHeight - this.scroller.clientHeight)
  }

  // ── Scrolling ─────────────────────────────────────────────────────────────

  private onScroll = () => {
    if (this.ignoreScroll) {
      this.ignoreScroll = false
      return
    }
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => void this.scrollOnce())
  }

  /** One scroll update at a time: each moves from where the last ended, so none count twice. */
  private async scrollOnce() {
    if (this.scrolling) {
      this.scrollAgain = true
      return
    }
    this.scrolling = true
    do {
      this.scrollAgain = false
      await this.applyScroll()
    } while (this.scrollAgain)
    this.scrolling = false
  }

  private async applyScroll() {
    const { scrollTop, scrollLeft } = this.scroller
    this.content.style.transform = `translate(${this.gutterWidth - scrollLeft}px, ${this.rowShift(scrollTop)}px)`
    this.gutter.style.transform = `translateY(${this.rowShift(scrollTop)}px)`
    if (this.lineMode) {
      const line = Math.floor(scrollTop / this.lineHeight)
      if (line === this.topLine && this.rows.length) return
      const generation = (this.generation += 1)
      const offset = await this.handle.lineStart(line)
      if (generation !== this.generation) return
      this.top = offset
      this.topLine = line
      await this.loadRows(generation)
      return
    }
    await this.applyByteScroll(scrollTop)
  }

  /**
   * In byte mode a pixel of scrollbar can span thousands of lines, so a small movement counts rows
   * from an anchor and only a large one jumps. The bar is brought back in line once scrolling
   * stops, not during it, because setting scrollTop would fight momentum.
   */
  private async applyByteScroll(scrollTop: number) {
    const moved = scrollTop - this.anchor.scrollTop
    if (Math.abs(moved) > this.scroller.clientHeight * 3) {
      const size = this.state?.size ?? 0
      const fraction = (scrollTop - SCROLL_MARGIN) / (this.scrollRange - SCROLL_MARGIN * 2)
      const target = Math.floor(Math.min(1, Math.max(0, fraction)) * size)
      this.top = await this.fullScreenFrom(await this.rowStartOf(target))
      this.anchor = { scrollTop, offset: this.top, rows: 0 }
    } else {
      const rows = Math.trunc(moved / this.lineHeight)
      const step = rows - this.anchor.rows
      if (step === 0 && this.rows.length) return
      if (step > 0) {
        const ahead = await this.handle.rows(this.top, step + 1, this.rowBytes)
        this.top = ahead[Math.min(step, ahead.length - 1)]!.start
      } else if (step < 0) {
        const behind = await this.handle.rowsBefore(this.top, -step, this.rowBytes)
        this.top = behind[0]?.start ?? 0
      }
      this.anchor.rows = rows
    }
    await this.loadRows()
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.settleScrollbar(), 200)
  }

  private settleScrollbar() {
    const size = this.state?.size ?? 0
    if (this.disposed || this.lineMode || !size) return
    const lastRow = this.rows.length > 0 && this.rows.length < this.viewportRows
    const scrollTop = this.top === 0 ? 0 : lastRow ? this.scrollRange : SCROLL_MARGIN + (this.top / size) * (this.scrollRange - SCROLL_MARGIN * 2)
    this.anchor = { scrollTop, offset: this.top, rows: 0 }
    if (Math.abs(scrollTop - this.scroller.scrollTop) >= 1) {
      this.ignoreScroll = true
      this.scroller.scrollTop = scrollTop
    }
  }

  private rowShift(scrollTop: number) {
    return this.lineMode ? -(scrollTop % this.lineHeight) : 0
  }

  /** Puts a row at the top of the screen. */
  private async jump(rowStart: number) {
    if (this.lineMode) {
      const line = Math.max(0, (await this.handle.lineAt(rowStart)) - Math.floor(this.viewportRows / 3))
      this.top = await this.handle.lineStart(line)
      this.topLine = line
      this.ignoreScroll = true
      this.scroller.scrollTop = line * this.lineHeight
    } else {
      const before = await this.handle.rowsBefore(rowStart, Math.floor(this.viewportRows / 3), this.rowBytes)
      this.top = before[0]?.start ?? rowStart
      this.settleScrollbar()
    }
    await this.loadRows()
  }

  /** Moves a top row up if it would leave the screen part empty at the end of the document. */
  private async fullScreenFrom(start: number) {
    const wanted = Math.max(1, this.viewportRows - 2)
    const ahead = await this.handle.rows(start, wanted, this.rowBytes)
    if (ahead.length >= wanted) return start
    const before = await this.handle.rowsBefore(start, wanted - ahead.length, this.rowBytes)
    return before[0]?.start ?? start
  }

  /** The start of the row holding a byte offset. */
  private async rowStartOf(offset: number): Promise<number> {
    const size = this.state?.size ?? 0
    const target = Math.min(offset, size)
    const limit = this.rowBytes * 8
    let start = await this.handle.lineStartBefore(target, limit)
    if (start > 0 && start === target - limit) start = await this.nextCharacter(start)
    for (;;) {
      const [row] = await this.handle.rows(start, 1, this.rowBytes)
      if (!row || target < row.next || row.next <= start || row.next >= size) return start
      start = row.next
    }
  }

  private async nextCharacter(offset: number) {
    const bytes = encoder.encode(await this.handle.text(offset, offset + 4))
    let skip = 0
    while (skip < bytes.length && (bytes[skip]! & 0xc0) === 0x80) skip += 1
    return offset + skip
  }

  // ── Rows ──────────────────────────────────────────────────────────────────

  private async loadRows(generation = (this.generation += 1)) {
    if (!this.viewportRows) return
    let rows: TextRow[]
    try {
      rows = await this.handle.rows(this.top, this.viewportRows + OVERSCAN, this.rowBytes)
      this.rowRetries = 0
    } catch {
      // A save can replace the file between a read and the document moving onto the new one.
      if (this.rowRetries < 5 && !this.disposed) {
        this.rowRetries += 1
        setTimeout(() => void this.refresh(), 60 * this.rowRetries)
      }
      return
    }
    if (generation !== this.generation || this.disposed || this.pendingEdits > 0) return
    this.topLine = this.lineMode ? this.topLine : await this.handle.lineAt(this.top)
    if (generation !== this.generation) return
    await this.prepareLexing(rows)
    if (generation !== this.generation) return
    this.rows = rows
    this.paint()
  }

  /** Finds the lexer state at the top row by lexing a little of what comes before it. */
  private async prepareLexing(rows: TextRow[]) {
    const { lexer } = this.options
    const first = rows[0]
    if (!lexer || !first || this.lexStates.has(first.start)) return
    if (first.start === 0) {
      this.lexStates.set(0, lexer.initial)
      return
    }
    if ((this.state?.tier ?? 3) > 1) return
    const from = await this.handle.lineStartBefore(Math.max(0, first.start - STATE_CONTEXT_BYTES))
    const context = await this.handle.rows(from, 4000, this.rowBytes)
    let state = lexer.initial
    for (const row of context) {
      if (row.start >= first.start) break
      this.lexStates.set(row.start, state)
      state = lexer.lex(row.text, state).state
    }
    this.lexStates.set(first.start, state)
  }

  private paint() {
    const { lexer } = this.options
    const current = this.caretRow()
    let line = this.topLine
    let state = this.lexStates.get(this.rows[0]?.start ?? 0) ?? lexer?.initial ?? 0
    let widest = 0
    const digits = Math.max(4, String(this.state?.lineCount ?? 1).length + (this.state?.exactLines ? 0 : 1))
    for (let index = 0; index < this.rowElements.length; index += 1) {
      const element = this.rowElements[index]!
      const number = this.gutterElements[index]!
      const row = index < this.viewportRows ? this.rows[index] : undefined
      if (!row) {
        element.textContent = ""
        // The key says what the row shows, so it has to go with the text or a repaint is skipped.
        delete element.dataset.key
        number.textContent = ""
        element.removeAttribute("data-current")
        number.removeAttribute("data-current")
        continue
      }
      const key = lexer ? `${row.text}\u0000${state}` : row.text
      if (element.dataset.key !== key) {
        element.dataset.key = key
        element.textContent = ""
        if (lexer) {
          const result = lexer.lex(row.text, state)
          for (const token of result.tokens) {
            if (token.kind) {
              const span = document.createElement("span")
              span.dataset.tok = token.kind
              span.textContent = token.text
              element.append(span)
            } else element.append(token.text)
          }
          state = result.state
        } else element.textContent = row.text
      } else if (lexer) state = lexer.lex(row.text, state).state
      if (lexer && row.next !== row.start) this.lexStates.set(row.next, state)
      element.dataset.start = String(row.start)
      element.toggleAttribute("data-current", index === current)
      number.toggleAttribute("data-current", index === current)
      number.textContent = this.rowLabel(row, index, line)
      if (!row.continues) line += 1
      widest = Math.max(widest, row.text.length)
    }
    this.gutter.style.inlineSize = `${digits + 2.5}ch`
    const gutter = this.gutter.getBoundingClientRect().width
    this.gutterWidth = gutter
    const contentWidth = (widest + 4) * this.charWidth + gutter
    const width = Math.max(contentWidth, this.scroller.clientWidth)
    this.spacer.style.inlineSize = `${width}px`
    this.content.style.inlineSize = `${width - gutter}px`
    const { scrollTop, scrollLeft } = this.scroller
    this.content.style.transform = `translate(${gutter - scrollLeft}px, ${this.rowShift(scrollTop)}px)`
    this.gutter.style.transform = `translateY(${this.rowShift(scrollTop)}px)`
    this.paintDecorations()
    this.report()
  }

  private gutterWidth = 0

  private rowLabel(row: TextRow, index: number, line: number) {
    const previous = index > 0 ? this.rows[index - 1] : undefined
    if (previous?.continues) return ""
    const label = (line + 1).toLocaleString("en-AU", { useGrouping: false })
    return this.state?.exactLines ? label : `≈${label}`
  }

  private rowIndexOf(offset: number) {
    const size = this.state?.size ?? 0
    return this.rows.findIndex((row, index) => {
      const next = this.rows[index + 1]
      if (offset < row.start) return false
      if (offset <= row.end) return true
      return offset < row.next || (!next && offset === size)
    })
  }

  private caretRow() {
    return this.rowIndexOf(this.selections[0]!.head)
  }

  /** UTF-16 column of a byte offset within a row. */
  private columnIn(row: TextRow, offset: number) {
    if (offset >= row.end) return row.text.length
    return utf16Length(encoder.encode(row.text).subarray(0, offset - row.start))
  }

  /** A DOM position for a column in a painted row. */
  private locate(rowElement: HTMLElement, column: number): [Node, number] {
    let left = column
    for (const child of rowElement.childNodes) {
      const text = child.nodeType === Node.TEXT_NODE ? child : child.firstChild
      const length = text?.nodeValue?.length ?? 0
      if (left <= length && text) return [text, left]
      left -= length
    }
    const last = rowElement.lastChild
    const text = last?.nodeType === Node.TEXT_NODE ? last : last?.firstChild
    return text ? [text, text.nodeValue?.length ?? 0] : [rowElement, 0]
  }

  private xOf(index: number, column: number) {
    const rowElement = this.rowElements[index]!
    if (column === 0) return 0
    const range = document.createRange()
    const [node, offset] = this.locate(rowElement, column)
    range.setStart(node, offset)
    range.setEnd(node, offset)
    const rects = range.getClientRects()
    const box = rects[rects.length - 1] ?? range.getBoundingClientRect()
    return box.left - rowElement.getBoundingClientRect().left
  }

  private paintMatches(rows: readonly TextRow[]) {
    const pattern = this.matchPattern
    if (!pattern) return
    rows.forEach((row, index) => {
      pattern.lastIndex = 0
      for (let match = pattern.exec(row.text); match; match = pattern.exec(row.text)) {
        if (match[0].length === 0) {
          pattern.lastIndex += 1
          continue
        }
        const start = this.xOf(index, match.index)
        const rect = element("div", "gux-match")
        rect.style.transform = `translate(${start}px, ${index * this.lineHeight}px)`
        rect.style.inlineSize = `${this.xOf(index, match.index + match[0].length) - start}px`
        this.selectionLayer.append(rect)
      }
    })
  }

  private paintMarks(rows: readonly TextRow[]) {
    for (const mark of this.marks) {
      rows.forEach((row, index) => {
        if (mark.end < row.start || mark.start > row.end) return
        const start = this.xOf(index, this.columnIn(row, Math.max(mark.start, row.start)))
        const end = Math.max(start + this.charWidth, this.xOf(index, this.columnIn(row, Math.min(mark.end, row.end))))
        const line = element("div", "gux-mark")
        line.dataset.severity = mark.severity
        line.title = mark.message
        line.style.transform = `translate(${start}px, ${(index + 1) * this.lineHeight - 4}px)`
        line.style.inlineSize = `${end - start}px`
        this.caretLayer.append(line)
      })
    }
  }

  private paintDecorations() {
    this.selectionLayer.textContent = ""
    this.caretLayer.textContent = ""
    const rows = this.rows.slice(0, this.viewportRows)
    this.paintMatches(rows)
    this.paintMarks(rows)
    const current = this.caretRow()
    rows.forEach((row, index) => {
      this.rowElements[index]!.toggleAttribute("data-current", index === current)
      this.gutterElements[index]!.toggleAttribute("data-current", index === current)
    })
    for (const selection of this.selections) {
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      if (from !== to) {
        rows.forEach((row, index) => {
          if (to < row.start || from > row.next) return
          if (from === row.next && !row.continues) return
          const start = this.xOf(index, this.columnIn(row, Math.max(from, row.start)))
          const pastEnd = to > row.end && !row.continues
          const end = this.xOf(index, this.columnIn(row, Math.min(to, row.end))) + (pastEnd ? this.charWidth : 0)
          if (end <= start) return
          const rect = element("div", "gux-selection-rect")
          rect.style.transform = `translate(${start}px, ${index * this.lineHeight}px)`
          rect.style.inlineSize = `${end - start}px`
          this.selectionLayer.append(rect)
        })
      }
      const index = this.rowIndexOf(selection.head)
      const row = rows[index]
      if (!row) continue
      const caret = element("div", "gux-caret")
      const x = this.xOf(index, this.columnIn(row, selection.head))
      caret.style.transform = `translate(${x}px, ${index * this.lineHeight}px)`
      this.caretLayer.append(caret)
      if (selection === this.selections[0]) this.placeInput(x, index)
    }
    this.syncInput()
  }

  private placeInput(x: number, index: number) {
    // Keeps the IME window and the browser's caret tracking at the real caret.
    this.input.style.transform = `translate(${x + this.gutterWidth - this.scroller.scrollLeft}px, ${index * this.lineHeight}px)`
  }

  private report() {
    this.options.onSelection?.()
    const { onStatus } = this.options
    const state = this.state
    if (!onStatus || !state) return
    const head = this.selections[0]!.head
    const index = this.rowIndexOf(head)
    const row = this.rows[index]
    let line = this.topLine
    for (let at = 0; at < index; at += 1) if (!this.rows[at]!.continues) line += 1
    onStatus({
      line,
      column: row ? this.columnIn(row, head) : 0,
      exactLines: state.exactLines,
      offset: head,
      size: state.size,
      tier: state.tier,
      selections: this.selections.length,
      canUndo: state.canUndo,
    })
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  /** With a screen reader the input holds the current row, so reading works; otherwise it stays empty. */
  private syncInput() {
    if (this.composing) return
    const index = this.caretRow()
    const row = this.rows[index]
    const head = this.selections[0]!.head
    const value = this.options.screenReader && row ? row.text : ""
    if (value !== this.inputValue || this.input.value !== value) {
      this.input.value = value
      this.inputValue = value
    }
    if (value && row) {
      const column = this.columnIn(row, head)
      this.input.setSelectionRange(column, column)
    }
  }

  private onInput = () => {
    if (this.composing) return
    const next = this.input.value
    const previous = this.inputValue
    let start = 0
    while (start < next.length && start < previous.length && next[start] === previous[start]) start += 1
    let end = 0
    while (end < next.length - start && end < previous.length - start && next[next.length - 1 - end] === previous[previous.length - 1 - end]) end += 1
    const inserted = next.slice(start, next.length - end)
    this.input.value = previous
    if (inserted) {
      this.command(() => this.insert(inserted, "typing"))
      this.options.onTyped?.(inserted)
    }
  }

  private onCompositionStart = () => {
    this.composing = true
    this.input.value = ""
    this.inputValue = ""
    this.input.dataset.composing = ""
  }

  private onCompositionEnd = (event: CompositionEvent) => {
    this.composing = false
    delete this.input.dataset.composing
    this.input.value = ""
    this.inputValue = ""
    const text = event.data
    if (text) this.command(() => this.insert(text))
  }

  /**
   * Replaces each selection with text. A single-line insertion is painted before the edit goes to
   * the document and returns at once, so a keystroke costs one frame whatever the document's size.
   * Anything else waits for the document, so the next command sees real rows.
   */
  private insert(text: string, group?: string): Promise<void> | void {
    this.caretBeforeEdit ??= this.selections.map((selection) => ({ ...selection }))
    if (this.options.readOnly) return
    const edits = this.selections.map(({ anchor, head }) => ({ start: Math.min(anchor, head), end: Math.max(anchor, head), text }))
    const bytes = utf8Length(text)
    const painted = this.applyOptimistic(edits, text, bytes)
    const ordered = [...edits].sort((a, b) => a.start - b.start)
    let shift = 0
    const moved = new Map<(typeof edits)[number], number>()
    for (const edit of ordered) {
      moved.set(edit, edit.start + shift + bytes)
      shift += bytes - (edit.end - edit.start)
    }
    this.selections = edits.map((edit) => ({ anchor: moved.get(edit)!, head: moved.get(edit)! }))
    this.desiredColumn = null
    this.paintDecorations()
    this.report()
    const applied = this.send(edits, group ? { group } : {})
    return painted ? undefined : applied
  }

  /** Sends edits, and once the last in flight has landed, replaces cached rows with real ones. */
  private async send(edits: ByteEdit[], options: { group?: string }) {
    this.generation += 1
    this.pendingEdits += 1
    const before = this.state?.version
    const caretBefore = this.caretBeforeEdit
    this.caretBeforeEdit = null
    this.state = await this.handle.edit(edits, options)
    // Where the caret was before a step and after it, so undo and redo put it back there.
    // Several edits can be in flight at once: the first to make a step is the one that began it.
    if (this.state.version !== before && caretBefore && !this.caretBefore.has(this.state.version)) this.caretBefore.set(this.state.version, caretBefore)
    this.caretAfter.set(this.state.version, this.selections.map((selection) => ({ ...selection })))
    this.pendingEdits -= 1
    this.setExtent()
    this.report()
    this.options.onChange?.(this.state)
    if (this.pendingEdits > 0) return
    this.lexStates.clear()
    await this.loadRows()
    await this.keepCaretVisible()
  }

  /** Patches cached rows in place, so the change shows now. The real rows replace them after. */
  private applyOptimistic(edits: { start: number; end: number; text: string }[], text: string, bytes: number): boolean {
    if (text.includes("\n") || edits.length !== 1) return false
    const edit = edits[0]!
    const index = this.rowIndexOf(edit.start)
    const row = this.rows[index]
    if (!row || edit.end > row.end) return false
    const before = this.columnIn(row, edit.start)
    const after = this.columnIn(row, edit.end)
    const delta = bytes - (edit.end - edit.start)
    const updated = { ...row, end: row.end + delta, next: row.next + delta, text: row.text.slice(0, before) + text + row.text.slice(after) }
    this.rows = this.rows.map((item, at) => (at < index ? item : at === index ? updated : { ...item, start: item.start + delta, end: item.end + delta, next: item.next + delta }))
    if (this.state) this.state = { ...this.state, size: this.state.size + delta }
    this.paint()
    return true
  }

  private async keepCaretVisible() {
    const head = this.selections[0]!.head
    const index = this.rowIndexOf(head)
    if (index < 0 || index >= this.viewportRows - 2) await this.reveal(head)
  }

  private async deleteBackward(word: boolean) {
    const ranges = await Promise.all(this.selections.map(async ({ anchor, head }) => {
      if (anchor !== head) return { start: Math.min(anchor, head), end: Math.max(anchor, head) }
      return { start: await this.previousStop(head, word), end: head }
    }))
    await this.remove(ranges)
  }

  private async deleteForward(word: boolean) {
    const ranges = await Promise.all(this.selections.map(async ({ anchor, head }) => {
      if (anchor !== head) return { start: Math.min(anchor, head), end: Math.max(anchor, head) }
      return { start: head, end: await this.nextStop(head, word) }
    }))
    await this.remove(ranges)
  }

  private async remove(ranges: { start: number; end: number }[]) {
    if (this.options.readOnly) return
    this.caretBeforeEdit ??= this.selections.map((selection) => ({ ...selection }))
    const edits = ranges.filter((range) => range.end > range.start).map((range) => ({ ...range, text: "" }))
    if (!edits.length) return
    const painted = this.applyOptimistic(edits, "", 0)
    const ordered = [...edits].sort((a, b) => a.start - b.start)
    let shift = 0
    this.selections = ordered.map((edit) => {
      const at = edit.start + shift
      shift -= edit.end - edit.start
      return { anchor: at, head: at }
    })
    this.paintDecorations()
    const applied = this.send(edits, { group: "delete" })
    if (!painted) await applied
  }

  private async indentText() {
    const [row] = await this.handle.rows(await this.lineStartOf(this.selections[0]!.head), 1, this.rowBytes)
    return /^[ \t]*/.exec(row?.text ?? "")![0]
  }

  private async lineStartOf(offset: number) {
    return this.handle.lineStartBefore(offset, this.rowBytes * 8)
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  private async rowAt(offset: number): Promise<TextRow> {
    const index = this.rowIndexOf(offset)
    if (index >= 0) return this.rows[index]!
    const [row] = await this.handle.rows(await this.rowStartOf(offset), 1, this.rowBytes)
    return row!
  }

  private async previousStop(offset: number, word: boolean): Promise<number> {
    if (offset <= 0) return 0
    const row = await this.rowAt(offset)
    if (offset === row.start) {
      const [before] = await this.handle.rowsBefore(row.start, 1, this.rowBytes)
      return before ? before.end : Math.max(0, offset - 1)
    }
    const column = this.columnIn(row, offset)
    const text = row.text.slice(0, column)
    return row.start + utf8Length(text, 0, stopBefore(text, word))
  }

  private async nextStop(offset: number, word: boolean): Promise<number> {
    const size = this.state?.size ?? 0
    if (offset >= size) return size
    const row = await this.rowAt(offset)
    if (offset >= row.end) return row.next === row.end && row.next >= size ? size : row.next
    const column = this.columnIn(row, offset)
    const stop = stopAfter(row.text.slice(column), word)
    return offset + utf8Length(row.text, column, column + stop)
  }

  private async move(step: (selection: Selection) => Promise<number>, extend: boolean, keepColumn = false) {
    const moved = await Promise.all(this.selections.map(async (selection) => {
      const head = await step(selection)
      return { anchor: extend ? selection.anchor : head, head }
    }))
    this.selections = mergeSelections(moved)
    if (!keepColumn) this.desiredColumn = null
    await this.reveal(this.selections[0]!.head)
  }

  private async moveVertical(direction: number, rows: number, extend: boolean) {
    const head = this.selections[0]!.head
    const current = await this.rowAt(head)
    this.desiredColumn ??= this.columnIn(current, head)
    const column = this.desiredColumn
    await this.move(async ({ head: from }) => {
      const row = await this.rowAt(from)
      const target = direction < 0
        ? (await this.handle.rowsBefore(row.start, rows, this.rowBytes))[0]
        : (await this.handle.rows(row.next, rows, this.rowBytes)).at(-1)
      if (!target || (direction > 0 && row.next >= (this.state?.size ?? 0) && row.next === row.end)) return direction < 0 ? 0 : from
      return target.start + utf8Length(target.text, 0, Math.min(column, target.text.length))
    }, extend, true)
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || this.composing) return
    if (this.options.onKey?.(event)) {
      event.preventDefault()
      return
    }
    const mod = isMac ? event.metaKey : event.ctrlKey
    const word = isMac ? event.altKey : event.ctrlKey
    const extend = event.shiftKey
    const run = (work: () => Promise<void> | void) => {
      event.preventDefault()
      this.command(work)
    }
    switch (event.key) {
      case "ArrowLeft":
        return run(() => this.move(async ({ anchor, head }) => (anchor !== head && !extend && !word ? Math.min(anchor, head) : this.previousStop(head, word)), extend))
      case "ArrowRight":
        return run(() => this.move(async ({ anchor, head }) => (anchor !== head && !extend && !word ? Math.max(anchor, head) : this.nextStop(head, word)), extend))
      case "ArrowUp":
        return run(() => (mod ? this.move(async () => 0, extend) : this.moveVertical(-1, 1, extend)))
      case "ArrowDown":
        return run(() => (mod ? this.move(async () => this.state?.size ?? 0, extend) : this.moveVertical(1, 1, extend)))
      case "PageUp":
        return run(() => this.moveVertical(-1, Math.max(1, this.viewportRows - 2), extend))
      case "PageDown":
        return run(() => this.moveVertical(1, Math.max(1, this.viewportRows - 2), extend))
      case "Home":
        return run(() => (mod ? this.move(async () => 0, extend) : this.move(async ({ head }) => this.homeOf(head), extend)))
      case "End":
        return run(() => (mod ? this.move(async () => this.state?.size ?? 0, extend) : this.move(async ({ head }) => (await this.rowAt(head)).end, extend)))
      case "Backspace":
        return run(() => this.deleteBackward(word))
      case "Delete":
        return run(() => this.deleteForward(word))
      case "Enter":
        return run(async () => {
          await this.insert(`\n${await this.indentText()}`)
        })
      case "Tab":
        if (this.tabMovesFocus) return
        return run(() => this.insert(TAB, "typing"))
      case "Escape":
        if (this.selections.length > 1 || this.selections[0]!.anchor !== this.selections[0]!.head) {
          const { head } = this.selections[0]!
          return run(() => this.select([{ anchor: head, head }]))
        }
        return
    }
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "m") {
      event.preventDefault()
      this.tabMovesFocus = !this.tabMovesFocus
      return
    }
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === "z") return run(() => (event.shiftKey ? this.redo() : this.undo()))
    if (key === "y" && !isMac) return run(() => this.redo())
    if (key === "a") return run(() => this.select([{ anchor: 0, head: this.state?.size ?? 0 }]))
  }

  /** Home toggles between the first non-space character and the start of the row. */
  private async homeOf(head: number) {
    const row = await this.rowAt(head)
    const indent = /^[ \t]*/.exec(row.text)![0].length
    const first = row.start + indent
    return head === first ? row.start : first
  }

  /** Undoes the last step. */
  async undo() {
    const from = this.state?.version
    this.state = await this.handle.undo()
    await this.afterHistory(from)
  }

  /** Redoes the last undone step. */
  async redo() {
    const from = this.state?.version
    this.state = await this.handle.redo()
    await this.afterHistory(from)
  }

  private async afterHistory(from?: number) {
    const size = this.state?.size ?? 0
    const kept = from === undefined ? undefined : this.state && this.state.version !== from ? (this.state.version < from ? this.caretBefore.get(from) : this.caretAfter.get(this.state.version)) : undefined
    const head = Math.min(kept?.[0]?.head ?? this.selections[0]!.head, size)
    this.selections = kept ? kept.map(({ anchor, head: end }) => ({ anchor: Math.min(anchor, size), head: Math.min(end, size) })) : [{ anchor: head, head }]
    this.setExtent()
    this.lexStates.clear()
    await this.loadRows()
    await this.keepCaretVisible()
    if (this.state) this.options.onChange?.(this.state)
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────

  private selectedRanges() {
    return this.selections.map(({ anchor, head }) => ({ start: Math.min(anchor, head), end: Math.max(anchor, head) })).filter((range) => range.end > range.start).sort((a, b) => a.start - b.start)
  }

  private onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    const text = this.cachedSelectionText()
    if (text !== null) event.clipboardData?.setData("text/plain", text)
  }

  private onCut = (event: ClipboardEvent) => {
    this.onCopy(event)
    this.command(() => this.remove(this.selectedRanges()))
  }

  private onPaste = (event: ClipboardEvent) => {
    event.preventDefault()
    const text = event.clipboardData?.getData("text/plain")
    if (text) this.command(() => this.insert(text))
  }

  /** The clipboard event is synchronous, so copying can only use text already on screen. */
  private cachedSelectionText(): string | null {
    const ranges = this.selectedRanges()
    if (!ranges.length) return null
    const parts: string[] = []
    for (const range of ranges) {
      const rows = this.rows.filter((row) => row.next > range.start && row.start < range.end)
      if (!rows.length || rows[0]!.start > range.start || rows.at(-1)!.next < range.end) return null
      parts.push(rows.map((row, index) => {
        const from = this.columnIn(row, Math.max(row.start, range.start))
        const to = this.columnIn(row, Math.min(row.end, range.end))
        return row.text.slice(from, to) + (index < rows.length - 1 && !row.continues ? "\n" : "")
      }).join(""))
    }
    return parts.join("\n")
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  private offsetFromPoint(x: number, y: number): number {
    const box = this.rowsLayer.getBoundingClientRect()
    const index = Math.max(0, Math.min(this.rows.length - 1, Math.floor((y - box.top) / this.lineHeight)))
    const row = this.rows[index]
    if (!row) return 0
    const rowElement = this.rowElements[index]
    if (!rowElement) return row.end
    const column = this.columnAtX(rowElement, row, x)
    return row.start + utf8Length(row.text, 0, column)
  }

  private columnAtX(rowElement: HTMLElement, row: TextRow, x: number) {
    const left = rowElement.getBoundingClientRect().left
    let low = 0
    let high = row.text.length
    const offsetFor = (column: number) => {
      const [node, offset] = this.locate(rowElement, column)
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset)
      const rects = range.getClientRects()
      return (rects[rects.length - 1] ?? range.getBoundingClientRect()).left - left
    }
    const target = x - left
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (offsetFor(middle) < target) low = middle + 1
      else high = middle
    }
    if (low > 0 && Math.abs(offsetFor(low - 1) - target) < Math.abs(offsetFor(low) - target)) return low - 1
    return low
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    this.focus()
    const offset = this.offsetFromPoint(event.clientX, event.clientY)
    if (event.altKey) this.selections = mergeSelections([...this.selections, { anchor: offset, head: offset }])
    else if (event.shiftKey) this.selections = [{ anchor: this.selections[0]!.anchor, head: offset }]
    else this.selections = [{ anchor: offset, head: offset }]
    this.desiredColumn = null
    this.paintDecorations()
    this.report()
    this.dragging = true
    this.content.setPointerCapture(event.pointerId)
    const onMove = (moved: PointerEvent) => {
      if (!this.dragging) return
      const last = this.selections[this.selections.length - 1]!
      last.head = this.offsetFromPoint(moved.clientX, moved.clientY)
      this.paintDecorations()
      this.report()
    }
    const onUp = () => {
      this.dragging = false
      this.content.removeEventListener("pointermove", onMove)
      this.content.removeEventListener("pointerup", onUp)
      this.selections = mergeSelections(this.selections)
    }
    this.content.addEventListener("pointermove", onMove)
    this.content.addEventListener("pointerup", onUp)
  }
}

/** Sorts selections and merges any that touch. */
export function mergeSelections(selections: readonly Selection[]): Selection[] {
  const ordered = [...selections].sort((a, b) => Math.min(a.anchor, a.head) - Math.min(b.anchor, b.head))
  const merged: Selection[] = []
  for (const selection of ordered) {
    const last = merged[merged.length - 1]
    const start = Math.min(selection.anchor, selection.head)
    if (last && start <= Math.max(last.anchor, last.head) && (start < Math.max(last.anchor, last.head) || selection.anchor !== selection.head)) {
      const end = Math.max(selection.anchor, selection.head, last.anchor, last.head)
      const from = Math.min(last.anchor, last.head)
      last.anchor = from
      last.head = end
    } else if (!last || last.anchor !== selection.anchor || last.head !== selection.head) merged.push({ ...selection })
  }
  return merged
}

function stopBefore(text: string, word: boolean) {
  const segmenter = word ? words : graphemes
  if (!segmenter) return Math.max(0, text.length - 1)
  let stop = 0
  let last = 0
  for (const part of segmenter.segment(text)) {
    if (word && !part.segment.trim()) continue
    stop = last = part.index
  }
  return word ? last : stop
}

function stopAfter(text: string, word: boolean) {
  const segmenter = word ? words : graphemes
  if (!segmenter) return Math.min(text.length, 1)
  for (const part of segmenter.segment(text)) {
    if (word && !part.segment.trim()) continue
    return part.index + part.segment.length
  }
  return text.length
}
