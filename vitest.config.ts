import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 2,
    include: [
      "src/main/**/*.test.ts",
      "src/renderer/**/*.test.ts",
      "src/shared/**/*.test.ts",
      "skills/**/tests/**/*.test.ts",
    ],
  },
});
