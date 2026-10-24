import { defineConfig } from "tsup";

export default defineConfig({
  // Built-ins such as node:sqlite require their node: prefix at runtime.
  removeNodeProtocol: false,
});
