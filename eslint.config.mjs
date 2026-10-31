import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".agent/**",
    ".taibu-local/**",
    "out/**",
    "build/**",
    "android/**/build/**",
    "packages/*/dist/**",
    ".release/**",
    "next-env.d.ts",
    ".worktrees/**",
    ".claude/worktrees/**",
    // Local tooling output: icon preview bundles, Playwright scratch pages and
    // screenshots. Bundled vendor code, not sources — same scope as .gitignore.
    ".icon-preview/**",
    ".playwright-mcp/**",
    // Generated skill artifacts (bundled vendor code) and eval workspaces.
    "skills/*/scripts/vendor/**",
    "skills/*-workspace/**",
  ]),
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["src/app/api/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    // Underscore marks a parameter or binding kept for its position or destructuring-only use.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
  {
    // eslint-config-next 16.4 enables the React Compiler lint rules as errors.
    // The existing codebase trips them (mostly setState-in-effect); keep them
    // visible as warnings so the framework patch upgrade stays behaviour-neutral.
    // Fix them incrementally in follow-up commits.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
