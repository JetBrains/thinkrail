import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { LoginScreen } from "@/components/LoginScreen/LoginScreen.tsx";
import { SetupScreen } from "@/components/SetupScreen/SetupScreen.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { userRestApi } from "@/api/methods/user.ts";
import { applyTheme, getThemePreference } from "./utils/theme.ts";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useTokenStore } from "@/store/tokenStore.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";
import "./styles/global.css";

applyTheme(getThemePreference());

const BACKEND = location.host;
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

function Root() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const token = useTokenStore((s) => s.token);

  // On mount: check setup status, then validate existing token
  useEffect(() => {
    // Fetch server info in parallel (best-effort)
    useServerInfoStore.getState().fetchInfo();

    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.needsSetup) {
          setNeedsSetup(true);
          setCheckingAuth(false);
          return;
        }
        // Setup done — validate existing token
        if (!token) {
          setCheckingAuth(false);
          return;
        }
        return userRestApi.getProfile(token).then((profile) => {
          if (profile) {
            useTokenStore.getState().setIsAdmin(profile.isAdmin);
            setAuthenticated(true);
          } else {
            useTokenStore.getState().setToken(null);
          }
          setCheckingAuth(false);
        });
      })
      .catch(() => {
        // Server unreachable — try existing token
        if (token) setAuthenticated(true);
        setCheckingAuth(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetupSuccess = useCallback(() => {
    setNeedsSetup(false);
    setAuthenticated(true);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const handleSelect = useCallback((path: string, isNew?: boolean) => {
    useFileStore.getState().unload();
    useSessionStore.getState().unload();
    useUiStore.getState().setIsNewProject(isNew ?? false);
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

  // First-time setup — no users exist yet
  if (needsSetup) {
    return <SetupScreen onSuccess={handleSetupSuccess} />;
  }

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
