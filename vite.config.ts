import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": "http://localhost:3333",
    },
    hmr: {
      protocol: "wss",
      host: "your-server.example.com",
      clientPort: 443,
      path: "/opengram-dev/",
    },
  },
});
