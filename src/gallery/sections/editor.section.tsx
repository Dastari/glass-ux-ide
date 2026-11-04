// tokens:allow-file boxes that give a demo the definite height its component needs
import { Example, SectionPage, Specimen } from "glass-ux-docs-kit/react"
import { typescriptLexer } from "../../languages/typescript/index.js"
import { CodeEditor, CodeField, CodeViewer } from "../../ui/code-editor/index.js"

const SAMPLE = `export function backoff(policy: RetryPolicy, attempt: number) {
  const delay = policy.baseMs * 2 ** attempt
  return new Promise((resolve) => setTimeout(resolve, delay))
}
`

export default function EditorSection() {
  return (
    <SectionPage>
      <Specimen title="CodeEditor" description="Short text through defaultValue. A file belongs in a document, and any size opens the same way.">
        <Example label="TypeScript" className="w-full">
          <div className="w-full" style={{ blockSize: "12rem" }}>
            <CodeEditor aria-label="Example" defaultValue={SAMPLE} lexer={typescriptLexer} />
          </div>
        </Example>
      </Specimen>
      <Specimen title="CodeViewer" description="The same scrolling and highlighting, with no editing.">
        <Example label="Read only" className="w-full">
          <div className="w-full" style={{ blockSize: "8rem" }}>
            <CodeViewer aria-label="Example" value={SAMPLE} lexer={typescriptLexer} />
          </div>
        </Example>
      </Specimen>
      <Specimen title="CodeField" description="Takes part in a form like any other control.">
        <Example label="With an error" className="w-full">
          <div className="w-full">
            <CodeField label="Policy" defaultValue={'{ "attempts": 5 }'} error="Expected a base delay." height="6rem" />
          </div>
        </Example>
      </Specimen>
    </SectionPage>
  )
}
