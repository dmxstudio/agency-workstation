import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not platform code (own tsconfig/node_modules/lint): runtime data with
    // generated projects, the generated-project template and the spikes.
    ".data/**",
    "templates/**",
    "spikes/**",
  ]),
]);

export default eslintConfig;
