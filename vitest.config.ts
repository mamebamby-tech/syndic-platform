import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/charger-env.ts"],
    testTimeout: 30_000,
  },
});
