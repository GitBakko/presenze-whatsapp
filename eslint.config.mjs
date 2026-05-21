import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const noIsoSplit = require("./eslint-rules/no-iso-split.cjs");

export default tseslint.config(
  { ignores: [".next/", "node_modules/"] },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
      local: { rules: { "no-iso-split": noIsoSplit } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "off",
      "react-hooks/exhaustive-deps": "warn",
      // React 19 + useCallback/fetch: setState inside async callbacks is the standard data-fetching pattern
      "react-hooks/set-state-in-effect": "off",
      "local/no-iso-split": "error",
    },
  },
);
