/**
 * Highlighting rules, compiled into a restartable state machine. Lexing a line needs only the
 * line and the state the previous line ended in, so highlighting can begin anywhere in a file
 * and an edit re-lexes only until the state matches again.
 */

/** A rule: where it matches, what to call it, and how the state changes. */
export interface LexerRule {
  match: RegExp
  token?: string
  /** Enters a state, remembering this one. */
  push?: string
  /** Returns to the state before. */
  pop?: boolean
}

/** A language's rules. `root` is where every document starts. */
export type LexerDefinition = Record<string, readonly LexerRule[]> & { root: readonly LexerRule[] }

/** A run of text with one token name. Plain text has none. */
export interface Token {
  text: string
  kind?: string
}

export interface LexResult {
  tokens: Token[]
  state: number
}

/** The stack is interned to a number, so states compare and store as cheaply as an integer. */
export interface Lexer {
  readonly initial: number
  lex(line: string, state: number): LexResult
}

/** Past this many characters a line stays plain, so a huge line costs nothing to highlight. */
const LEX_LIMIT = 4096

/** Compiles rules. Patterns are made sticky, so they match only at the current position. */
export function compileLexer(definition: LexerDefinition): Lexer {
  const states = new Map(Object.entries(definition).map(([name, rules]) => [name, rules.map((rule) => ({ ...rule, match: new RegExp(rule.match.source, rule.match.flags.replace(/[gy]/g, "") + "y") }))]))
  const stacks: string[][] = [["root"]]
  const ids = new Map([["root", 0]])
  const intern = (stack: string[]) => {
    const key = stack.join("/")
    let id = ids.get(key)
    if (id === undefined) {
      id = stacks.length
      stacks.push(stack)
      ids.set(key, id)
    }
    return id
  }
  return {
    initial: 0,
    lex(line, startState) {
      let stack = stacks[startState] ?? stacks[0]!
      const tokens: Token[] = []
      const add = (text: string, kind?: string) => {
        const last = tokens[tokens.length - 1]
        if (last && last.kind === kind) last.text += text
        else tokens.push(kind ? { text, kind } : { text })
      }
      const end = Math.min(line.length, LEX_LIMIT)
      let at = 0
      while (at < end) {
        const rules = states.get(stack[stack.length - 1]!) ?? []
        let matched = false
        for (const rule of rules) {
          rule.match.lastIndex = at
          const found = rule.match.exec(line)
          if (!found) continue
          if (found[0].length > 0) add(found[0], rule.token)
          if (rule.push) stack = [...stack, rule.push]
          else if (rule.pop && stack.length > 1) stack = stack.slice(0, -1)
          // An empty match that changes nothing would loop for ever.
          matched = found[0].length > 0 || Boolean(rule.push || rule.pop)
          at += found[0].length
          if (matched) break
        }
        if (!matched) {
          add(line[at]!)
          at += 1
        }
      }
      if (at < line.length) add(line.slice(at))
      return { tokens, state: intern(stack) }
    },
  }
}
