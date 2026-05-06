// ESLint flat config (v9). React + TypeScript via typescript-eslint.
// Run: `npm run lint` (also runs `tsc --noEmit` first).

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // ── Ignore generated, vendored, and build outputs ────────────────────────
  {
    ignores: [
      "dist/",
      "node_modules/",
      "src/api/generated.ts", // openapi-typescript output
      "src/types/ws-events.ts", // json-schema-to-typescript output
      "openapi.json",
      "ws-events.json",
      "*.config.js", // this file itself, vite.config.*, vitest.config.*
      "*.config.ts",
    ],
  },

  // ── Base JS recommendations ──────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommendations (non-type-checked) ────────────────────────
  // We use the non-type-checked tier for speed; `tsc --noEmit` already runs
  // full type-checking via the lint script. Avoiding the typed lint pass keeps
  // ESLint runs fast and avoids duplicating tsc work.
  ...tseslint.configs.recommended,

  // ── React hooks + Vite HMR enforcement ───────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Classic hooks correctness — keep these on.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── React Compiler advisory rules (eslint-plugin-react-hooks v7) ───
      // Bonsai is not using React Compiler. These rules surface migration
      // hints rather than real bugs and produce a lot of noise on idiomatic
      // React 18/19 code. Disable until we adopt React Compiler.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",

      // Vite HMR enforcement — keep as a warning.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // `any` is sometimes the pragmatic choice (third-party shims, dynamic
      // payloads). Surface it but don't fail the lint.
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow underscore-prefixed unused vars (e.g. _err in catch, _unused params).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // tsc already enforces this with `noUnusedLocals` / `noUnusedParameters`.
      "no-unused-vars": "off",
    },
  },

  // ── Ambient declarations: `declare var` is the conventional pattern for
  //   global browser/runtime globals; the runtime `no-var` rule is not
  //   meaningful here.
  {
    files: ["src/**/*.d.ts"],
    rules: {
      "no-var": "off",
    },
  },

  // ── Test files: relax `any` and unused-vars (mocks legitimately use both)
  {
    files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
);
