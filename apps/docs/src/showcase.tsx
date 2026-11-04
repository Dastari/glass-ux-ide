import { lazy, Suspense, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ButtonLink } from "glass-ux/button-link";
import { IconArrowRight, IconArrowUpRight, IconExpand, IconFile } from "glass-ux/icons";
import { Metric } from "glass-ux/metric";
import { Panel, PanelBody, PanelHeader } from "glass-ux/surface";
import { createWindowManager, registerWindowKind, useWindowManager, Window, WindowManagerProvider, Workspace, type WindowContentProps } from "glass-ux/windows";
import { Button } from "glass-ux/button";
import { CodeEditor, CodeField, CodeViewer } from "glass-ux-ide/editor";
import { typescriptLexer } from "glass-ux-ide/languages/typescript";
import { SOURCES } from "./demo/project";
import "./showcase.css";

const DemoApp = lazy(() => import("./demo/demo-app").then((module) => ({ default: module.DemoApp })));

/** Links from a demo to the pages of the components it shows. */
function ComponentLinks({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="showcase-component-links" aria-label="Components in this demo">
      {items.map(([id, label]) => (
        <Link key={id} to="/components/$component" params={{ component: id }}>
          {label}
          <IconArrowUpRight />
        </Link>
      ))}
    </div>
  );
}

const nameOf = (path: string) => path.split("/").pop() ?? path;

/** A `CodeEditor` in a managed window: a kind says how to title it, and the body is the editor. */
function NoteWindow({ params }: WindowContentProps<{ path: string }>) {
  return (
    <Window.Body variant="fill">
      <CodeEditor aria-label={nameOf(params.path)} defaultValue={SOURCES[params.path]} lexer={typescriptLexer} framed={false} />
    </Window.Body>
  );
}

registerWindowKind<{ path: string }>({
  kind: "showcase.code",
  title: ({ path }) => nameOf(path),
  subtitle: ({ path }) => path,
  icon: IconFile,
  key: ({ path }) => `showcase.code.${path}`,
  size: { w: 460, h: 280 },
  popout: false,
  load: async () => ({ default: NoteWindow }),
});

function OpenButtons() {
  const manager = useWindowManager();
  return (
    <div className="showcase-window-actions">
      {["src/sync/policy.ts", "src/sync/types.ts", "src/storage/journal.ts"].map((path) => (
        <Button key={path} size="sm" variant="secondary" icon={<IconFile />} onClick={() => manager.open({ kind: "showcase.code", params: { path }, layout: "floating" })}>
          {nameOf(path)}
        </Button>
      ))}
    </div>
  );
}

function WindowsDemo() {
  const manager = useMemo(() => createWindowManager({ storageKey: null, channelName: null }), []);
  return (
    <WindowManagerProvider manager={manager}>
      <div className="showcase-windows">
        <Workspace className="showcase-workspace" primaryLabel="Code windows" primary={<OpenButtons />} />
      </div>
    </WindowManagerProvider>
  );
}

export function Showcase() {
  return (
    <div className="showcase">
      <header className="showcase-hero">
        <h1>Glass UX IDE</h1>
        <p>A code editor and IDE parts for glass-ux applications, for files of any size.</p>
        <div className="showcase-hero-actions">
          <ButtonLink variant="primary" render={<Link to="/guides/$guide" params={{ guide: "getting-started" }} />} iconEnd={<IconArrowRight />}>
            Getting started
          </ButtonLink>
          <ButtonLink variant="secondary" render={<Link to="/demo" />} icon={<IconExpand />}>
            Open the demo
          </ButtonLink>
        </div>
      </header>

      <section id="application" className="showcase-section" aria-labelledby="application-title">
        <div className="showcase-section-heading">
          <div>
            <h2 id="application-title">Application demo</h2>
            <p className="text-fg-muted">Files in memory, a 100 GB log and a scripted language service.</p>
          </div>
        </div>
        <div className="showcase-app">
          <Suspense fallback={<div className="showcase-app-placeholder" role="status" aria-label="Loading the demo" />}>
            <DemoApp />
          </Suspense>
        </div>
        <ComponentLinks
          items={[
            ["workbench", "Workbench"],
            ["editor-area", "Editor area"],
            ["explorer-view", "Explorer"],
            ["search-view", "Search"],
            ["changes-view", "Changes"],
            ["problems-panel", "Problems"],
            ["workbench-status-bar", "Status bar"],
          ]}
        />
      </section>

      <section id="sizes" className="showcase-section" aria-labelledby="sizes-title">
        <div className="showcase-section-heading">
          <h2 id="sizes-title">Measured on real files</h2>
        </div>
        <div className="showcase-metrics">
          <Panel><PanelBody><Metric label="Open a 20 GB file" value={56} unit="ms" /></PanelBody></Panel>
          <Panel><PanelBody><Metric label="Keystroke, slowest 1%" value={6.3} unit="ms" /></PanelBody></Panel>
          <Panel><PanelBody><Metric label="Page memory at 20 GB" value={10} unit="MB" /></PanelBody></Panel>
          <Panel><PanelBody><Metric label="Slow frames in 240 while scrolling" value={0} /></PanelBody></Panel>
        </div>
      </section>

      <section id="editors" className="showcase-section" aria-labelledby="editors-title">
        <div className="showcase-section-heading">
          <h2 id="editors-title">Editors on their own</h2>
        </div>
        <div className="showcase-editors">
          <Panel>
            <PanelHeader title="CodeEditor" />
            <PanelBody className="showcase-editor-body">
              <CodeEditor aria-label="Example" defaultValue={SOURCES["src/sync/policy.ts"]} lexer={typescriptLexer} framed={false} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="CodeViewer" />
            <PanelBody className="showcase-editor-body">
              <CodeViewer aria-label="Example" value={SOURCES["src/sync/types.ts"]} lexer={typescriptLexer} framed={false} />
            </PanelBody>
          </Panel>
        </div>
        <Panel>
          <PanelBody>
            <CodeField label="Retry policy" defaultValue={'{ "attempts": 5 }'} error="Expected a base delay." height="5rem" />
          </PanelBody>
        </Panel>
        <ComponentLinks items={[["code-editor", "CodeEditor"], ["code-viewer", "CodeViewer"], ["code-field", "CodeField"]]} />
      </section>

      <section id="windows" className="showcase-section" aria-labelledby="windows-title">
        <div className="showcase-section-heading">
          <div>
            <h2 id="windows-title">Code in windows</h2>
            <p className="text-fg-muted">Each button opens a CodeEditor in a managed window. Drag, snap, tile or close them.</p>
          </div>
        </div>
        <WindowsDemo />
      </section>

      <footer className="showcase-footer">
        <p className="type-caption text-fg-muted">All sample data is fictional. Edits reset when the page reloads.</p>
      </footer>
    </div>
  );
}
