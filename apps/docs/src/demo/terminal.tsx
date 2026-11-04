import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useWorkbench } from "glass-ux-ide/workbench"
import { listFiles } from "glass-ux-ide/backend"
import "./terminal.css"

const signal = new AbortController().signal

/**
 * An application's own panel, added through `panels`. This one is a few commands over the same
 * file provider as the explorer. A real terminal belongs to the application and its server.
 */
export function DemoTerminal() {
  const workbench = useWorkbench()
  const [lines, setLines] = useState<readonly string[]>(["Type help for the commands."])
  const [input, setInput] = useState("")
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [lines])

  const run = async (text: string) => {
    const [command, argument] = text.trim().split(/\s+/)
    const provider = workbench.backend.files?.[0]
    const write = (...more: string[]) => setLines((current) => [...current, `$ ${text}`, ...more].slice(-200))
    if (!command) return write()
    if (!provider) return write("No files connected.")
    const files = await listFiles(provider, signal)
    const find = () => files.find((file) => file.uri.endsWith(`/${argument}`))
    if (command === "help") return write("ls              list the project's files", "cat <file>      print a file", "open <file>     open a file in a tab", "clear           clear this panel")
    if (command === "clear") return setLines([])
    if (command === "ls") return write(...files.map((file) => file.uri.replace("project:///", "")))
    const file = find()
    if (command === "open" || command === "cat") {
      if (!file) return write(`${argument ?? "That file"} was not found.`)
      if (command === "open") {
        await workbench.open(file.uri)
        return write(`Opened ${file.name}`)
      }
      const bytes = await provider.read(file.uri, { offset: 0, length: file.size ?? 0 }, { signal })
      return write(...new TextDecoder().decode(bytes).split("\n"))
    }
    write(`${command}: command not found`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    void run(input)
    setInput("")
  }

  return (
    <div className="demo-terminal">
      <div ref={log} className="demo-terminal-log" role="log" aria-label="Terminal output">
        {lines.map((line, index) => (
          <div key={index}>{line || " "}</div>
        ))}
      </div>
      <label className="demo-terminal-prompt">
        <span aria-hidden="true">$</span>
        <input aria-label="Terminal command" value={input} spellCheck={false} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} />
      </label>
    </div>
  )
}
