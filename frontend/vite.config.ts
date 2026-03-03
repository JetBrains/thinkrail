import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
      "/terminal": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
