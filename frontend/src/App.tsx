import { useEffect, useRef } from "react";
import { BrowserRouter } from "react-router-dom";
import { useRpc, useConnectionState, setClient } from "@/api/index.ts";
import { wireEvents } from "@/store/wireEvents.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { registerKeyboardShortcuts } from "@/utils/keyboard.ts";
import { NewSessionModal } from "@/components/NewSessionModal/NewSessionModal.tsx";
import { CommandPalette } from "@/components/CommandPalette/CommandPalette.tsx";
import { ToastContainer } from "@/components/Notifications/ToastContainer.tsx";
import { AppRoutes } from "./routes.tsx";

function AppInner({ projectPath: _projectPath, onSwitchProject }: { projectPath: string; onSwitchProject: () => void }) {
  const client = useRpc();
  const connectionState = useConnectionState();
  const wiredRef = useRef(false);

  // Wire events + fetch initial data on connect
  useEffect(() => {
    console.log("[Bonsai] Connection state:", connectionState);
    if (connectionState === "connected" && !wiredRef.current) {
      wiredRef.current = true;
      setClient(client);
      wireEvents(client);
      useUiStore.getState().setProject(_projectPath);
      console.log("[Bonsai] Fetching specs...");
      useSpecStore.getState().fetchSpecs().then(() => {
        console.log("[Bonsai] Specs loaded:", useSpecStore.getState().specs.length);
      });
      useSpecStore.getState().fetchGraph();
      // Restore sessions that have live backend runners (survives page refresh)
      useSessionStore.getState().loadActiveSessions().catch((err) => {
        console.warn("[Bonsai] Failed to load active sessions:", err);
      });
    }
    if (connectionState === "disconnected" || connectionState === "failed") {
      wiredRef.current = false;
    }
  }, [connectionState, client]);

  // Global keyboard shortcuts
  useEffect(() => registerKeyboardShortcuts(), []);

  // Viewport resize tracking
  useEffect(() => {
    const onResize = () =>
      useUiStore.getState().updateViewport(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes onSwitchProject={onSwitchProject} />
      <NewSessionModal />
      <CommandPalette />
      <ToastContainer />
    </BrowserRouter>
  );
}

export function App({
  projectPath,
  onSwitchProject,
}: {
  projectPath: string;
  onSwitchProject: () => void;
}) {
  return <AppInner projectPath={projectPath} onSwitchProject={onSwitchProject} />;
}
