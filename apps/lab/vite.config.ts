import { defineConfig } from "vite"

export default defineConfig({
  root: "apps/lab",
  server: { port: 4320, host: "127.0.0.1", allowedHosts: [".ts.net"], fs: { allow: ["../.."] } },
  worker: { format: "es" },
})
