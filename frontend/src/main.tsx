import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

const BACKEND = import.meta.env.DEV ? "localhost:8000" : location.host;
const WS_PROTO = import.meta.env.DEV ? "ws:" : location.protocol === "https:" ? "wss:" : "ws:";

function Root() {
  const [projectPath, setProjectPath] = useState<string | null>(null);

  if (!projectPath) {
    return <ProjectPicker onSelect={setProjectPath} />;
  }

  const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}`;

  return (
    <RpcProvider url={wsUrl} key={projectPath}>
      <App
        projectPath={projectPath}
        onSwitchProject={() => setProjectPath(null)}
      />
    </RpcProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
