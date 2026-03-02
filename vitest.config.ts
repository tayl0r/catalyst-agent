import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts", "server/**/*.ts", "client/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "client/src/main.tsx",
        "client/src/vite-env.d.ts",
        "server/data/**",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
