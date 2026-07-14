import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/domain/**",
        "src/processor/**",
        "src/providers/x/jwt.ts",
        "src/providers/x/otpCheck.ts",
        "src/providers/x/emailPlaceholder.ts",
        "src/providers/x/epubParser.ts"
      ],
      exclude: [
        "src/portal/**",
        "src/providers/d/**",
        "src/providers/x/r2.ts",
        "src/server.ts",
        "src/index.ts",
        "src/config.ts",
        "src/domain/types.ts"
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70
      }
    }
  }
});
