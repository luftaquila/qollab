import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  base: "/apply/",
  plugins: [vue()],
  server: {
    proxy: {
      "/apply/api": "http://127.0.0.1:3001",
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: { sourcemap: true },
});
