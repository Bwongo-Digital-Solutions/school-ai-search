import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8787";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: process.env.VITE_DEV_HOST || "::",
    port: 8080,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
