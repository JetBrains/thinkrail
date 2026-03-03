import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

// In dev, connect directly to backend (avoids Vite WS proxy conflicts).
// In production, use the same host (backend serves frontend static files).
const wsUrl =
  import.meta.env.DEV
    ? "ws://localhost:8000/ws"
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RpcProvider url={wsUrl}>
      <App />
    </RpcProvider>
  </StrictMode>,
);
