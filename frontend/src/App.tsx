import { useEffect, useRef } from "react";
import { BrowserRouter } from "react-router-dom";
import { useRpc, useConnectionState, setClient } from "@/api/index.ts";
import { wireEvents } from "@/store/wireEvents.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore, startWatchdog, stopWatchdog } from "@/store/sessionStore.ts";
import { useUiStore } from "@/store/uiStore.ts";
import { useVisStore } from "@/store/visStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { registerKeyboardShortcuts } from "@/utils/keyboard.ts";
import { applyFontScale } from "@/utils/fontScale.ts";
import { CommandPalette } from "@/components/CommandPalette/CommandPalette.tsx";
import { TrashModal } from "@/components/TrashModal/TrashModal.tsx";
import { ToastContainer } from "@/components/Notifications/ToastContainer.tsx";
import { AppRoutes } from "./routes.tsx";

function AppInner({ projectPath: _projectPath, onSwitchProject }: { projectPath: string; onSwitchProject: () => void }) {
  const client = useRpc();
  const connectionState = useConnectionState();
  const wiredRef = useRef(false);
  const wireCleanupRef = useRef<(() => void) | null>(null);

  // Wire events + fetch initial data on connect
  useEffect(() => {
    console.log("[Bonsai] Connection state:", connectionState);
    if (connectionState === "connected" && !wiredRef.current) {
      // ── Initial connect ──
      wiredRef.current = true;
      setClient(client);
      wireCleanupRef.current?.();
      wireCleanupRef.current = wireEvents(client);
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
      // Load vis dashboard for StatusBar one-liner and VisTab
      useVisStore.getState().fetchState();
      // Load board tickets
      useBoardStore.getState().fetchTickets();
      // Load project settings and model list
      useSettingsStore.getState().fetchSettings();
      useSettingsStore.getState().fetchModels();
    } else if (connectionState === "connected" && wiredRef.current) {
      // ── Reconnect: WS recovered — sync session statuses immediately ──
      console.log("[Bonsai] Reconnected — syncing session statuses");
      useSessionStore.getState().syncSessionStatuses().catch((err) => {
        console.warn("[Bonsai] Failed to sync session statuses on reconnect:", err);
      });
    }
    if (connectionState === "disconnected" || connectionState === "failed") {
      wiredRef.current = false;
    }
  }, [connectionState, client]);

  // Watchdog: start/stop based on connection state
  useEffect(() => {
    if (connectionState === "connected") {
      startWatchdog();
    } else {
      stopWatchdog();
    }
    return () => stopWatchdog();
  }, [connectionState]);

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

  // Apply font scale from settings (use separate primitive selectors to avoid infinite loop)
  const fontSize = useSettingsStore((s) => s.settings?.font_size ?? 13);
  const compactFontSize = useSettingsStore((s) => s.settings?.compact_font_size ?? 9);

  useEffect(() => {
    applyFontScale(fontSize, compactFontSize);
  }, [fontSize, compactFontSize]);

  return (
    <BrowserRouter>
      <AppRoutes onSwitchProject={onSwitchProject} />
      <CommandPalette />
      <TrashModal />
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
