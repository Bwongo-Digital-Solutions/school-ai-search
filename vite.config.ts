import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "path";

const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8787";

const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")).version;

// Build number: an explicit CI value, else the short git hash, else 'dev'.
const buildNumber = (() => {
  if (process.env.BUILD_NUMBER) return process.env.BUILD_NUMBER;
  try {
    return execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return "dev";
  }
})();

const developerContacts = process.env.DEVELOPER_CONTACTS || "e-School · support@e-school.app";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __DEVELOPER_CONTACTS__: JSON.stringify(developerContacts),
  },
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
