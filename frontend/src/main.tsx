import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { LoginScreen } from "@/components/LoginScreen/LoginScreen.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { userRestApi } from "@/api/methods/user.ts";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useTokenStore } from "@/store/tokenStore.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

const BACKEND = location.host;
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

function Root() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const token = useTokenStore((s) => s.token);

  // On mount: validate existing token
  useEffect(() => {
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    userRestApi.getProfile(token).then((profile) => {
      if (profile) {
        setAuthenticated(true);
      } else {
        // Stale token — clear it
        useTokenStore.getState().setToken(null);
      }
      setCheckingAuth(false);
    }).catch(() => {
      // Server unreachable — still try to connect (token might be valid)
      setAuthenticated(true);
      setCheckingAuth(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoginSuccess = useCallback(() => {
    setAuthenticated(true);
  }, []);

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

  // Still checking stored token
  if (checkingAuth) return null;

  // Not authenticated — show login screen
  if (!authenticated) {
    return <LoginScreen onSuccess={handleLoginSuccess} />;
  }

  // No project selected yet — full-screen picker (no close button)
  if (!projectPath) {
    return <ProjectPicker onSelect={handleSelect} />;
  }

  const currentToken = useTokenStore.getState().token;
  const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}${currentToken ? `&token=${encodeURIComponent(currentToken)}` : ""}`;

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
