// ESLint flat config.
//
// Two very different environments live in this repo:
//   app.web/server.js, selfcheck.js, test/  → Node, CommonJS
//   app.web/public/index.html               → browser JS, inline in <script> tags
//
// eslint-plugin-html extracts the inline scripts from the HTML so they get
// linted too. Without it the entire frontend — most of the code in this project
// — would be invisible to the linter.

import js from "@eslint/js";
import globals from "globals";
import html from "eslint-plugin-html";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/data/**",          // the local ledger — never touch it
      "app.web/public/chart.umd.min.js", // vendored, not ours
      "website/build/**",
      "website/.docusaurus/**",
    ],
  },

  // --- Node: the backend, the self check, the smoke tests ---
  {
    files: ["app.web/server.js", "app.web/selfcheck.js", "app.web/test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // caughtErrors:"none" allows the existing `catch (e) { ... }` idiom where the
      // error object is deliberately ignored. Tighten to "all" once the app code is
      // touched for other reasons — changing it now would mean editing app.web during
      // a migration, which this project deliberately avoids.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["warn", "smart"],
    },
  },

  // --- Browser: the inline <script> inside index.html ---
  {
    files: ["app.web/public/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser, Chart: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
