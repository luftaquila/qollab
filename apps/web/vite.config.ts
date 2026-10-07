import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: [
      "vue",
      "yjs",
      "@milkdown/kit",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
    ],
  },
  server: { proxy: { "/api": { target: "http://127.0.0.1:3000", ws: true } } },
  build: { manifest: true, sourcemap: true },
});
