import { defineConfig, type OxfmtConfig } from "oxfmt";

// Same style as the alchemy repo, so code copied from repos/alchemy needs no reformatting.
export default defineConfig({
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  endOfLine: "lf",
  trailingComma: "all",
  sortPackageJson: true,
  insertFinalNewline: true,
  sortImports: {
    newlinesBetween: false,
  },
  ignorePatterns: [
    "repos/**",
    "**/dist/**",
    "**/.astro/**",
    "**/*.md",
    "**/*.mdx",
    "pnpm-lock.yaml",
  ],
} satisfies OxfmtConfig);
