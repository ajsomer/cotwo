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
  ]),
  {
    // Keep console.error/warn (the documented error-handling convention) but
    // flag stray console.log so dev traces don't regress into production —
    // they leak internal state to the browser console on patient devices.
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // The console SMS provider is a deliberate console-based stub; its
    // console.log calls ARE its behaviour in the prototype.
    files: ["src/lib/sms/console.ts"],
    rules: { "no-console": "off" },
  },
  {
    // server.ts is the long-running Node process (Socket.IO + Next). Its
    // console logs are operational server-side logging, not browser noise —
    // the concern no-console guards against (leaking state to patient devices)
    // doesn't apply here.
    files: ["server.ts"],
    rules: { "no-console": "off" },
  },
]);

export default eslintConfig;
