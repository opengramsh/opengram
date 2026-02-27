import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router"],
          "vendor-streamdown": [
            "streamdown",
            "@streamdown/cjk",
            "@streamdown/code",
          ],
          "vendor-katex": ["@streamdown/math"],
          "vendor-mermaid": ["@streamdown/mermaid"],
          "vendor-shiki": ["shiki"],
        },
      },
    },
  },
  server: {
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": "http://localhost:3334",
    },
  },
});
