// ESLint 9 flat config for the ProcureX frontend.
//
// This is a standalone config runnable via `npm run lint` (and by editor
// ESLint integrations), separate from the lightweight react-hooks overlay
// CRA's dev server applies on its own via craco.config.js's `eslint`
// key - that one only governs `npm start`/`npm run build`'s webpack
// overlay and stays as-is. This file is the full, CI-able lint pass.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";

export default [
  js.configs.recommended,
  {
    ignores: ["build/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // CRA/craco resolve "@/..." aliases and CSS/asset imports that this
      // plugin's resolver can't see without extra config - keep only the
      // duplicate-import check, which needs no resolver.
      "import/no-duplicates": "warn",
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/display-name": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["**/*.test.js", "**/*.test.jsx", "src/setupTests.js"],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
  },
];
