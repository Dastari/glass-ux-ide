import { defineConfig } from "vite"

export default defineConfig({
  root: "apps/lab",
  // Its own dependency cache, apart from the docs site's server that runs beside it in the tests.
  cacheDir: "node_modules/.vite/lab",
  server: { port: 4320, host: "127.0.0.1", allowedHosts: [".ts.net"], fs: { allow: ["../.."] } },
  worker: { format: "es" },
})
