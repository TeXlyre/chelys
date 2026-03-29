import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const basePath = '';
const appVersion = process.env.npm_package_version || '1.0.0';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BASE_PATH__: JSON.stringify(basePath.slice(0, -1)),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "localhost",
    fs: {
      allow: [".", "./external"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      '@/i18n': path.resolve(__dirname, './src/i18n-shim.ts'),
      '@texlyre': path.resolve(__dirname, './external/texlyre/src'),
      '@chelys': path.resolve(__dirname, './external/texlyre/chelys'),
      '@src': path.resolve(__dirname, './src'),
      '@': path.resolve(__dirname, './src'),
      'webrtc-adapter': path.resolve(__dirname, './src/webrtc-polyfill/webrtc-adapter-shim.ts'),
    },
  },
});
