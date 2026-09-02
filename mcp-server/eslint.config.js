// ESLint flat config. Deliberately modest: TypeScript `strict` in tsc is the
// primary correctness gate, so lint exists to catch the classes tsc cannot
// (floating promises are the expensive one here — a swallowed rejection in the
// collector daemon or the ingestion pipeline is exactly how events go missing)
// and to keep style out of code review. Formatting is Prettier's job;
// eslint-config-prettier turns off every rule that would fight it.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", ".models/**", "demo-store/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Applies everywhere, including the plain-JS helper scripts.
    rules: {
      // Empty catch is allowed: the codebase uses `try { ... } catch {}` for
      // genuinely best-effort work (unlink a stale lock, stat a file for a
      // size report, test cleanup). Lint cannot tell those from the swallowed
      // errors that mattered — that is what code review is for.
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off", // stderr logging is the deliberate transport-safe pattern
    },
  },

  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped promise in the poll loop / ingestion path silently loses
      // events. This is the rule the whole type-aware setup is here for.
      "@typescript-eslint/no-floating-promises": "error",
      // `checksVoidReturn.arguments` is off: passing an async callback to an
      // API that ignores the return value (setInterval, process.on, an Express
      // handler) is the normal shape here and rewriting every one into a
      // void-IIFE would be noise. The valuable half of the rule — a promise
      // used in a condition, spread, or void return position — stays on.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false } },
      ],

      // Unused code is usually a leftover from a refactor. `_`-prefixed args
      // are the documented escape hatch (used widely for Express handlers).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // `any` appears in this codebase where third-party shapes are genuinely
      // untyped (MCP SDK payloads, js-yaml output, sqlite rows). Flagging every
      // one would produce noise nobody reads, so it warns rather than blocks;
      // new code should still avoid it.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    // Tests: looser. Fixtures legitimately use `any` and non-null assertions,
    // and a floating promise in a test fails the test rather than losing data.
    // tsconfig.json excludes __tests__ from the build, so there is no type
    // information for them — type-aware rules are switched off rather than
    // maintaining a second tsconfig purely for lint.
    files: ["src/__tests__/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },

  {
    // Plain-JS helper scripts (build wrapper, demo generator) and the
    // retrieval eval harness. No type info for either.
    files: ["scripts/**/*.mjs", "eval/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "no-undef": "off", // node globals resolved at runtime; tsc does not cover .mjs
    },
  },

  prettier,
);
