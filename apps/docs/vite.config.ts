import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { glassUx } from "glass-ux/vite";

const source = (path: string) => new URL(`../../src/${path}`, import.meta.url).pathname;

export default defineConfig({
  // A project site on GitHub Pages sets this to its repository path, such as /my-package/.
  base: process.env.DOCS_BASE ?? "/",
  plugins: [react(), tailwind(), glassUx()],
  // Its own dependency cache: the lab's server runs beside it in the browser tests, and a shared cache
  // would make each server's pre-bundles out of date for the other.
  cacheDir: new URL("../../node_modules/.vite/docs", import.meta.url).pathname,
  // The demo imports the package by name, as an application does, and runs from source here.
  resolve: {
    alias: {
      "glass-ux-ide/backend": source("backend/index.ts"),
      "glass-ux-ide/core": source("core/index.ts"),
      "glass-ux-ide/editor": source("ui/code-editor/index.ts"),
      "glass-ux-ide/languages/typescript": source("languages/typescript/index.ts"),
      "glass-ux-ide/languages/json": source("languages/json/index.ts"),
      "glass-ux-ide/languages/css": source("languages/css/index.ts"),
      "glass-ux-ide/languages/markdown": source("languages/markdown/index.ts"),
      "glass-ux-ide/languages/html": source("languages/html/index.ts"),
      "glass-ux-ide/format": source("format/index.ts"),
      "glass-ux-ide/workbench": source("ui/workbench/index.ts"),
    },
    dedupe: ["react", "react-dom", "glass-ux"],
  },
  // The kit imports glass-ux entries: bundled apart they would be a second copy of its contexts.
  // The scan also crawls the package's own source, which sits outside this folder: a dependency it only
  // met later would be bundled mid-session, reloading the pages using it.
  optimizeDeps: {
    exclude: ["glass-ux-docs-kit"],
    include: ["glass-ux-docs-kit > clsx"],
    entries: ["index.html", "src/**/*.tsx", "../../src/ui/**/*.tsx", "../../src/gallery/sections/*.tsx", "../../src/gallery/demos/*.tsx"],
  },
  // The site reads the project's sources from outside this folder.
  server: {
    fs: { allow: ["../.."] },
    allowedHosts: [".ts.net"],
    // The demo loads lazily: transforming it at start finds its dependencies before a page asks for them,
    // so the first visit is not reloaded part way through while they are bundled.
    warmup: { clientFiles: ["./src/main.tsx", "./src/showcase.tsx", "./src/demo/demo-app.tsx"] },
  },
});
