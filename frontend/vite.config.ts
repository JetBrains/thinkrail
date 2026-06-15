import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

function openApiCodegen(): Plugin {
  const schemaPath = path.resolve(__dirname, "openapi.json");
  const outputPath = path.resolve(__dirname, "src/api/generated.ts");

  function generate() {
    try {
      execSync(`npx openapi-typescript "${schemaPath}" -o "${outputPath}"`, {
        cwd: __dirname,
        stdio: "pipe",
      });
      console.log("[openapi] regenerated src/api/generated.ts");
    } catch (e) {
      console.error("[openapi] codegen failed:", e);
    }
  }

  return {
    name: "openapi-codegen",
    configureServer(server) {
      generate();
      server.watcher.add(schemaPath);
      server.watcher.on("change", (file) => {
        if (file === schemaPath) {
          generate();
          // Invalidate generated module so HMR picks up the new types
          const mod = server.moduleGraph.getModuleByUrl("/src/api/generated.ts");
          if (mod) server.reloadModule(mod);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const backendPort = env.BACKEND_PORT ?? "8000";
  const frontendPort = parseInt(env.FRONTEND_PORT ?? "3000", 10);

  return {
    plugins: [react(), openApiCodegen()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    test: {
      setupFiles: ["./vitest.setup.ts"],
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
