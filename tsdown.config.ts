/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports, unicorn/prefer-module */
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/main.ts"],

  format: ["esm"],
  target: "es2022",
  platform: "node",

  sourcemap: false,
  clean: true,
  removeNodeProtocol: false,

  env: {
    NODE_ENV: "production",
  },

  // Handle .sql files imported with { type: "text" } as raw text
  inputOptions: {
    plugins: [
      {
        name: "sql-text-loader",
        load(id) {
          if (id.endsWith(".sql")) {
            const content = require("node:fs").readFileSync(id, "utf8")
            return `export default ${JSON.stringify(content)};`
          }
        },
      },
    ],
  },

  // Mark native modules as external
  external: ["better-sqlite3", "bun:sqlite"],
})
