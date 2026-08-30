import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Tests read tests/fixtures/vault and nothing else. If a test ever needs a
    // real vault, the test is wrong.
    environment: "node",
    // Pinned so the DST tests are real. They assert on a 25-hour day, which
    // only exists in a DST zone — on a UTC runner they silently passed and the
    // regression they exist to catch would have shipped green.
    env: { TZ: "America/Los_Angeles" },
  },
});
