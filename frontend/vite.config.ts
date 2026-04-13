import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.BACKEND_PORT ?? "8000";
  const frontendPort = parseInt(env.FRONTEND_PORT ?? "3000", 10);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: frontendPort,
      host: "0.0.0.0",
      proxy: {
        "/ws": {
          target: `http://localhost:${backendPort}`,
          ws: true,
          changeOrigin: true,
        },
        "/terminal": {
          target: `http://localhost:${backendPort}`,
          ws: true,
          changeOrigin: true,
        },
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
