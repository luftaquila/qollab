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
  build: {
    manifest: true,
    sourcemap: true,
    // The CSP allows fonts only from this origin, so small fonts (KaTeX's
    // Size3) stay files instead of data: URLs.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
