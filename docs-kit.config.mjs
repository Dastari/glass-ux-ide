import { defineDocsKit } from "glass-ux-docs-kit/config";

// The package name, version, entries, homepage and repository come from package.json.
export default defineDocsKit({
  title: "Glass UX IDE",
  entries: {
    exclude: ["./package.json", "./i18n/*", "./core", "./backend", "./react", "./view", "./format", "./languages/typescript", "./languages/json", "./languages/css", "./languages/markdown", "./languages/html"],
    referenceOnly: ["src/core/index.ts", "src/backend/index.ts", "src/react/index.ts", "src/view/index.ts", "src/format/index.ts", "src/languages/typescript/index.ts", "src/languages/json/index.ts", "src/languages/css/index.ts", "src/languages/markdown/index.ts", "src/languages/html/index.ts"],
  },
  guides: ["getting-started", "backends", "code-windows", "performance"],
  checks: {
    // The view works without glass-ux, so its fallbacks are its own token layer.
    tokenDirs: ["src/ui"],
    // Pane and box sizes here are values for components' props, which follow UI scale.
    presentationDirs: ["src/gallery", "apps/docs/src", "src/ui/workbench", "src/ui/code-editor"],
  },
  hooks: {
    // The demo on its own is a route of the site's, not a catalogue page.
    routes: () => ["demo"],
  },
  llms: {
    intro: "A code editor, reusable editing components and backend interfaces for glass-ux applications.",
    links: [{ title: "Design", path: "docs/DESIGN.md" }],
  },
});
