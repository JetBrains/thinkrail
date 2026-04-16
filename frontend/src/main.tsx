import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, useNavigate, useLocation } from "react-router-dom";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { LoginScreen } from "@/components/LoginScreen/LoginScreen.tsx";
import { SetupScreen } from "@/components/SetupScreen/SetupScreen.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { getSetupStatus } from "@/services/setup.ts";
import { getUserProfile } from "@/services/user.ts";
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

const LAST_PROJECT_KEY = "bonsai-last-project";

function pathToSlug(fsPath: string): string {
  return encodeURIComponent(fsPath.split("/").filter(Boolean).pop() ?? "project");
}

function isWorkspacePath(pathname: string): boolean {
  return /^\/[^/]+\/workspace/.test(pathname);
}

// ─── Root ────────────────────────────────────────────────────────────────────
// URL is the single source of truth for navigation state:
//   /                     → project picker
//   /workspace            → redirect to /:lastSlug/workspace (convenience)
//   /:slug/workspace      → workspace (full project path stored in location.state)
//
// Back button always works because we never manipulate state behind React Router's back.

function Root() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const token = useTokenStore((s) => s.token);

  useEffect(() => {
    // Fetch server info in parallel (best-effort)
    useServerInfoStore.getState().fetchInfo();

    getSetupStatus()
      .then((status) => {
        if (status.needsSetup) {
          setNeedsSetup(true);
          setCheckingAuth(false);
          return;
        }
        if (!token) {
          setCheckingAuth(false);
          return;
        }
        return getUserProfile(token).then((profile) => {
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
        if (token) setAuthenticated(true);
        setCheckingAuth(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // All callbacks defined before any conditional returns (rules of hooks)
  const handleSetupSuccess = useCallback(() => {
    setNeedsSetup(false);
    setAuthenticated(true);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const handleSelect = useCallback(
    (path: string, isNew?: boolean) => {
      useFileStore.getState().unload();
      useSessionStore.getState().unload();
      useUiStore.getState().setIsNewProject(isNew ?? false);
      localStorage.setItem(LAST_PROJECT_KEY, path);
      navigate(`/${pathToSlug(path)}/workspace`, { state: { projectPath: path } });
    },
    [navigate],
  );

  // "Switch project" navigates to / (workspace is still in history → back returns to it)
  const handleSwitchProject = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // ── Pre-auth screens ──────────────────────────────────────────────────────
  if (checkingAuth) return null;
  if (needsSetup) return <SetupScreen onSuccess={handleSetupSuccess} />;
  if (!authenticated) return <LoginScreen onSuccess={handleLoginSuccess} />;

  // ── /workspace → redirect to last project ────────────────────────────────
  if (location.pathname === "/workspace") {
    const last = localStorage.getItem(LAST_PROJECT_KEY);
    if (last) {
      return (
        <Navigate
          to={`/${pathToSlug(last)}/workspace`}
          state={{ projectPath: last }}
          replace
        />
      );
    }
    // No last project → fall through to picker
  }

  // ── /:slug/workspace → workspace ─────────────────────────────────────────
  const projectPath = (location.state as { projectPath?: string } | null)?.projectPath;
  if (isWorkspacePath(location.pathname) && projectPath) {
    const token = useTokenStore.getState().token;
    const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    return (
      <RpcProvider url={wsUrl} key={projectPath}>
        <App projectPath={projectPath} onSwitchProject={handleSwitchProject} />
      </RpcProvider>
    );
  }

  // ── / (or unknown path) → project picker ─────────────────────────────────
  return <ProjectPicker onSelect={handleSelect} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
