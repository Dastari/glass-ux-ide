/**
 * A drawing of the editor surface, for mock-ups only. The real one is not React: see
 * docs/DESIGN.md, "Rendering". This shows geometry, decorations and token colours.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"

type Token = { text: string; kind?: string }

const TS_RULES: [RegExp, string][] = [
  [/^(\/\/.*|\/\*\*?.*?\*\/)/, "comment"],
  [/^"[^"]*"/, "string"],
  [/^\b(import|from|type|export|class|private|readonly|new|constructor|async|await|const|let|void|if|for|of|while|break|return|this)\b/, "keyword"],
  [/^\b(true|false|null|undefined|\d[\d_]*)\b/, "constant"],
  [/^[A-Z][A-Za-z0-9]+/, "type"],
  [/^[a-zA-Z_$][\w$]*(?=\()/, "function"],
  [/^[{}()[\]<>=:;,.?+!|&-]+/, "punctuation"],
  [/^[a-zA-Z_$][\w$]*/, "plain"],
  [/^\s+/, "plain"],
  [/^./, "plain"],
]

const LOG_RULES: [RegExp, string][] = [
  [/^"(ts|level|region|route|ms|trace)"/, "type"],
  [/^"ERROR"/, "error"],
  [/^"WARN"/, "warn"],
  [/^"[^"]*"/, "string"],
  [/^\d+/, "constant"],
  [/^[{}:,]+/, "punctuation"],
  [/^./, "plain"],
]

export function tokenise(line: string, language: "ts" | "log"): Token[] {
  const rules = language === "ts" ? TS_RULES : LOG_RULES
  const tokens: Token[] = []
  let rest = line
  while (rest) {
    for (const [rule, kind] of rules) {
      const match = rule.exec(rest)
      if (match) {
        const last = tokens[tokens.length - 1]
        if (last && last.kind === kind) last.text += match[0]
        else tokens.push({ text: match[0], kind })
        rest = rest.slice(match[0].length)
        break
      }
    }
  }
  return tokens
}

export interface Squiggle {
  line: number
  start: number
  end: number
  tone: "danger" | "warning"
}

export interface RowChange {
  line: number
  kind: "add" | "change" | "remove"
}

export interface CodeSurfaceProps {
  lines: readonly string[]
  language?: "ts" | "log"
  /** The number shown on the first row. */
  firstLine?: number
  caret?: { line: number; column: number }
  squiggles?: readonly Squiggle[]
  changes?: readonly RowChange[]
  /** Rows that have a fold chevron. */
  folds?: readonly number[]
  /** Highlighted search matches on a row: [line, start, end]. */
  matches?: readonly (readonly [number, number, number])[]
  /** Indices of rows with an error or warning glyph in the gutter. */
  glyphs?: readonly (readonly [number, "danger" | "warning"])[]
  gutterChars?: number
  minimap?: "code" | "density" | false
  /** Popups placed against the text grid. */
  children?: ReactNode
  "aria-label": string
}

const ROW = 1.375 // rem, matches --ide-line

/** Places a popup at a character cell. */
export function cellStyle(line: number, column: number, gutterChars = 4): CSSProperties {
  return {
    insetInlineStart: `calc(var(--ide-gutter-pad) + ${gutterChars}ch + var(--ide-gutter-glyphs) + ${column}ch)`,
    insetBlockStart: `${(line + 1) * ROW}rem`,
  }
}

export function CodeSurface({
  lines,
  language = "ts",
  firstLine = 1,
  caret,
  squiggles = [],
  changes = [],
  folds = [],
  matches = [],
  glyphs = [],
  gutterChars = 4,
  minimap = "code",
  children,
  "aria-label": label,
}: CodeSurfaceProps) {
  return (
    <div className="ide-surface" dir="ltr" role="textbox" aria-multiline aria-readonly aria-label={label} tabIndex={0}>
      <div className="ide-grid" style={{ "--ide-gutter-chars": gutterChars } as CSSProperties}>
        {lines.map((line, index) => {
          const number = firstLine + index
          const change = changes.find((item) => item.line === index)
          const glyph = glyphs.find(([row]) => row === index)
          return (
            <div key={index} className="ide-row" data-current={caret?.line === index ? "" : undefined}>
              <span className="ide-glyph" data-tone={glyph?.[1]} aria-hidden />
              <span className="ide-number" data-numeric>
                {number.toLocaleString("en-AU")}
              </span>
              <span className="ide-change" data-kind={change?.kind} aria-hidden />
              <span className="ide-fold" data-fold={folds.includes(index) ? "" : undefined} aria-hidden />
              <span className="ide-code">
                {matches
                  .filter(([row]) => row === index)
                  .map(([, start, end]) => (
                    <i key={start} className="ide-match" style={{ insetInlineStart: `${start}ch`, width: `${end - start}ch` }} />
                  ))}
                {squiggles
                  .filter((item) => item.line === index)
                  .map((item) => (
                    <i key={item.start} className="ide-squiggle" data-tone={item.tone} style={{ insetInlineStart: `${item.start}ch`, width: `${item.end - item.start}ch` }} />
                  ))}
                {caret?.line === index ? <i className="ide-caret" style={{ insetInlineStart: `${caret.column}ch` }} /> : null}
                {tokenise(line, language).map((token, part) => (
                  <span key={part} data-tok={token.kind}>
                    {token.text}
                  </span>
                ))}
                {line ? null : "​"}
              </span>
            </div>
          )
        })}
        {children}
      </div>
      {minimap ? <Minimap lines={lines} language={language} mode={minimap} matches={matches.length} /> : null}
    </div>
  )
}

function Minimap({ lines, language, mode, matches }: { lines: readonly string[]; language: "ts" | "log"; mode: "code" | "density"; matches: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const paint = () => {
      const box = canvas.getBoundingClientRect()
      if (!box.width || !box.height) return
      const scale = window.devicePixelRatio || 1
      canvas.width = box.width * scale
      canvas.height = box.height * scale
      const context = canvas.getContext("2d")
      if (!context) return
      context.scale(scale, scale)
      const styles = getComputedStyle(canvas)
      const colour = (name: string) => styles.getPropertyValue(`--ide-tok-${name}`).trim() || styles.color
      if (mode === "density") {
        // Sampled from the sparse index: match density and errors, never text.
        for (let y = 0; y < box.height; y += 3) {
          const heat = (Math.sin(y * 0.031) + Math.sin(y * 0.0071 + 2) + 2) / 4
          context.globalAlpha = 0.14 + heat * 0.34
          context.fillStyle = colour("punctuation")
          context.fillRect(0, y, box.width * (0.35 + heat * 0.65), 2)
          if (y % 57 < 3 && matches) {
            context.globalAlpha = 0.95
            context.fillStyle = colour("match")
            context.fillRect(0, y, box.width, 2)
          }
        }
        return
      }
      context.globalAlpha = 0.72
      const rows = Math.ceil(box.height / 3)
      for (let row = 0; row < rows; row += 1) {
        const line = lines[row % lines.length] ?? ""
        let x = 3
        for (const token of tokenise(line, language)) {
          const width = token.text.length * 0.9
          if (token.text.trim()) {
            context.fillStyle = colour(token.kind ?? "plain")
            context.fillRect(x, row * 3, Math.min(width, box.width - x), 2)
          }
          x += width
          if (x > box.width) break
        }
      }
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [lines, language, mode, matches])
  return (
    <div className="ide-minimap" data-mode={mode} aria-hidden>
      <canvas ref={ref} />
      <i className="ide-minimap-view" />
    </div>
  )
}
