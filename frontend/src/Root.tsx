import { useCallback, useEffect } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { ProjectPicker } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";

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

export function Root() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Fetch server info in parallel (best-effort)
    useServerInfoStore.getState().fetchInfo();
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
    const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}`;
    return (
      <RpcProvider url={wsUrl} key={projectPath}>
        <App projectPath={projectPath} onSwitchProject={handleSwitchProject} />
      </RpcProvider>
    );
  }

  // ── / (or unknown path) → project picker ─────────────────────────────────
  return <ProjectPicker onSelect={handleSelect} />;
}
