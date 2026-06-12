import { useCallback, useEffect } from "react";
import { STORAGE_PREFIX } from "@/constants/branding.ts";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { RpcProvider } from "@/api/index.ts";
import { App } from "./App.tsx";
import { ProjectPicker, type NewProjectData } from "@/components/ProjectPicker/ProjectPicker.tsx";
import { useFileStore } from "@/store/fileStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useServerInfoStore } from "@/store/serverInfoStore.ts";

const BACKEND = location.host;
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

const LAST_PROJECT_KEY = `${STORAGE_PREFIX}last-project`;

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
    (path: string, newProjectData?: NewProjectData) => {
      useFileStore.getState().unload();
      useSessionStore.getState().unload();
      // projectState is fetched from the server on workspace mount
      // (see App.tsx) — picker no longer needs to guess.
      useUiStore.getState().setProjectState(null);
      // Reset wizard chain so the next entry-point screen (new-project
      // form or detect screen) gets to pin the right chain itself.
      useUiStore.getState().setCurrentChain(null);
      // Drop the cumulative stepper journey — it belongs to the project
      // we're leaving; the next project starts a fresh path.
      useUiStore.getState().clearWizardJourney();
      // Reset centerView to sessions so the new project starts with
      // the appropriate default view instead of inheriting the persisted
      // centerView from the previous project.
      useUiStore.getState().setCenterView("sessions");
      localStorage.setItem(LAST_PROJECT_KEY, path);
      navigate(`/${pathToSlug(path)}/workspace`, { state: { projectPath: path, newProjectData } });
    },
    [navigate],
  );

  // "Switch project" navigates to / or opens a specific project
  const handleSwitchProject = useCallback((projectPath?: string) => {
    if (projectPath) {
      handleSelect(projectPath);
    } else {
      navigate("/");
    }
  }, [navigate, handleSelect]);

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
  const state = location.state as { projectPath?: string; newProjectData?: NewProjectData } | null;
  const projectPath = state?.projectPath;
  const newProjectData = state?.newProjectData;
  if (isWorkspacePath(location.pathname) && projectPath) {
    const wsUrl = `${WS_PROTO}//${BACKEND}/ws?project=${encodeURIComponent(projectPath)}`;
    return (
      <RpcProvider url={wsUrl} key={projectPath}>
        <App projectPath={projectPath} onSwitchProject={handleSwitchProject} newProjectData={newProjectData} />
      </RpcProvider>
    );
  }

  // ── / (or unknown path) → project picker ─────────────────────────────────
  return <ProjectPicker onSelect={handleSelect} />;
}
