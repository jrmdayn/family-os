import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    reportUnusedDisableDirectives: "error",
  },
  plugins: ["import", "typescript", "node", "unicorn", "oxc"],
  ignorePatterns: ["repos/**", "**/dist/**", "**/.astro/**", ".alchemy/**"],
  rules: {
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],
    // Effect generators often yield nothing (e.g. `Effect.gen(function* () { return 1 })`).
    "require-yield": "off",
  },
});
