import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Tests read tests/fixtures/vault and nothing else. If a test ever needs a
    // real vault, the test is wrong.
    environment: "node",
  },
});
