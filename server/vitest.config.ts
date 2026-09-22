import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    globalSetup: ["test/globalSetup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
      APP_ENCRYPTION_KEY: "0".repeat(63) + "1",
      STORAGE_DIR: "./test-storage",
      CRAWLER_MIN_DELAY_MS: "0",
      AI_PROVIDER: "none",
      SCHEDULER_ENABLED: "false",
    },
  },
});
