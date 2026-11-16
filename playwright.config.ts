import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4320", viewport: { width: 1200, height: 800 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "firefox", use: { browserName: "firefox" } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: [
    { command: "pnpm exec vite --config apps/lab/vite.config.ts", url: "http://127.0.0.1:4320", reuseExistingServer: true },
    // Ready once the demo's module can be served, which on a cold cache waits for Vite to bundle the
    // dependencies; a test that loads the demo before then gets a failed dynamic import.
    { command: "pnpm exec vite apps/docs --host 127.0.0.1 --port 4311 --strictPort", url: "http://127.0.0.1:4311/src/demo/demo-app.tsx", reuseExistingServer: true, timeout: 60_000 },
  ],
})
