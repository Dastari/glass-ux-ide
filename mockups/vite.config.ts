import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { glassUx } from "glass-ux/vite"

// Relative base so the build works under any path; every asset small enough is inlined so
// scripts/single-file.mjs can fold the result into one HTML file that opens from disk.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), glassUx()],
  // The package's source and this app must share one copy, or contexts would not connect.
  resolve: { dedupe: ["glass-ux", "react", "react-dom"] },
  server: { allowedHosts: [".ts.net"], fs: { allow: [".."] } },
  build: { assetsInlineLimit: 8_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 8000 },
})
