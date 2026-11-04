import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--experimental-ffi"],
    include: ["src/**/*.integration.test.ts", "src/**/*.integration.test.tsx"],
    exclude: ["**/node_modules/**", "**/.git/**"],
    globalSetup: ["src/test/integration-setup.ts"],
  },
});
