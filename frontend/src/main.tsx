import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

const BACKEND = location.host;
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

function Root() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(true);

  const handleSelect = useCallback((path: string) => {
    useFileStore.getState().unload();
    useSessionStore.getState().unload();
    setProjectPath(path);
    setShowPicker(false);
  }, []);

  const handleSwitchProject = useCallback(() => {
    setShowPicker(true);
  }, []);

  const handleClosePicker = useCallback(() => {
    // Only allow close if we already have a project open
    if (projectPath) setShowPicker(false);
  }, [projectPath]);

  // No project selected yet — full-screen picker (no close button)
  if (!projectPath) {
    return <ProjectPicker onSelect={handleSelect} />;
  }

  const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}`;

  return (
    <RpcProvider url={wsUrl} key={projectPath}>
      <App
        projectPath={projectPath}
        onSwitchProject={handleSwitchProject}
      />
      {showPicker && (
        <ProjectPicker
          onSelect={handleSelect}
          onClose={handleClosePicker}
        />
      )}
    </RpcProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
