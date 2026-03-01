import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const version = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../version.json"), "utf8"),
).version;
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
} catch {}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_COMMIT__: JSON.stringify(commit),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    proxy: {
      "/ws": {
        target: "http://localhost:2999",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:2999",
        changeOrigin: true,
      },
    },
  },
});
