/**
 * The demo is written the way an application would write its IDE: it supplies files and a small
 * fictional language service, and everything else comes from the package.
 */
import type { FileProvider } from "glass-ux/file-provider";
import { memoryFiles } from "glass-ux/file-provider/memory";
import { BrandMark } from "glass-ux/brand";
import { IconTerminal } from "glass-ux/icons";
import { ShellBrand, ThemeToggle } from "glass-ux/shell";
import { syntheticSource } from "glass-ux-ide/core";
import { cssLexer } from "glass-ux-ide/languages/css";
import { htmlLexer } from "glass-ux-ide/languages/html";
import { jsonLexer } from "glass-ux-ide/languages/json";
import { markdownLexer } from "glass-ux-ide/languages/markdown";
import { typescriptLexer } from "glass-ux-ide/languages/typescript";
import { Workbench, type WorkbenchPanel } from "glass-ux-ide/workbench";
import { demoBackend } from "./backend";
import { SOURCES } from "./project";
import { DemoTerminal } from "./terminal";

/** A generated file behind a real provider: no write, so it opens read-only. */
function logFiles(): FileProvider {
  const size = 100 * 1024 ** 3;
  const source = syntheticSource({ size });
  const file = { uri: "logs:///events-2026-10.ndjson", name: "events-2026-10.ndjson", kind: "file" as const, size, version: "1" };
  return {
    scheme: "logs",
    label: "Logs",
    stat: async () => file,
    read: (_uri, { offset, length }) => source.read(offset, Math.min(length, size - offset)),
    readDirectory: async () => ({ entries: [file], cursor: null }),
  };
}

// At module scope: edits outlive the component, as files would.
const project = memoryFiles(SOURCES, { scheme: "project", label: "harbour-api" });
Object.assign(globalThis, { demoProject: project });
const backend = demoBackend([project, logFiles()], project);
const lexers = { ts: typescriptLexer, tsx: typescriptLexer, json: jsonLexer, md: markdownLexer, css: cssLexer, html: htmlLexer };
const initialFiles = ["project:///src/sync/replica-queue.ts"];
const panels: readonly WorkbenchPanel[] = [{ id: "terminal", title: "Terminal", icon: <IconTerminal />, component: DemoTerminal, keepRunning: true }];

/** The whole application. It fills its parent. */
export function DemoApp() {
  return (
    <Workbench
      backend={backend}
      lexers={lexers}
      initialFiles={initialFiles}
      panels={panels}
      brand={<ShellBrand href={import.meta.env.BASE_URL} label="Back to the documentation" mark={<BrandMark mark="product" />} />}
      actions={<ThemeToggle />}
    />
  );
}
