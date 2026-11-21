import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "_site/**", "site/node_modules/**", "site/.cache/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The documentation site's generator, checks and tools (#669) run in Node.
    files: ["site/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", URL: "readonly", URLSearchParams: "readonly", WebSocket: "readonly", console: "readonly", fetch: "readonly",
        process: "readonly", setTimeout: "readonly", clearTimeout: "readonly" }
    }
  },
  {
    // The site's one script, served to browsers (docs/design/engine-site.md, 6.3).
    files: ["site/assets/search.js"],
    languageOptions: {
      sourceType: "module",
      globals: { document: "readonly", history: "readonly", location: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        URL: "readonly", URLSearchParams: "readonly", Event: "readonly" }
    }
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
