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

const clientPort = process.env.CATAGENT_CLIENT_PORT || 2998;
const serverPort = process.env.CATAGENT_SERVER_PORT || 2999;

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
    port: Number(clientPort),
    proxy: {
      "/ws": {
        target: `http://localhost:${serverPort}`,
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
