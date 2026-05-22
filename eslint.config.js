import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".tools/**",
      ".netlify/**",
      "coverage/**",
      "public/data/latest.json",
      "public/data/status.json",
      "src/data/journals.json",
      "src/data/openalex-source-map.json",
      "src/data/unresolved-journals.csv",
      "docs/nursing_journals_codex_ready.json"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "react-refresh/only-export-components": ["warn", { "allowConstantExport": true }]
    }
  }
];
