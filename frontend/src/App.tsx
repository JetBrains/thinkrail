import { useEffect, useRef } from "react";
import { useRpc, useConnectionState, setClient } from "@/api/index.ts";
import { wireEvents } from "@/store/wireEvents.ts";
import { useSpecStore } from "@/store/specStore.ts";
import { useSessionStore, startWatchdog, stopWatchdog } from "@/store/sessionStore.ts";
import { useUiStore, sessionLoadStrategy } from "@/store/uiStore.ts";
import { useBoardStore } from "@/store/boardStore.ts";
import { useSettingsStore } from "@/store/settingsStore.ts";
import { useRuntimeCapsStore } from "@/store/runtimeCapsStore.ts";
import { registerKeyboardShortcuts } from "@/utils/keyboard.ts";
import { applyFontScale } from "@/utils/fontScale.ts";
import { validateProject } from "@/services/project.ts";
import { ToastContainer } from "@/components/Notifications/ToastContainer.tsx";
import { AppRoutes } from "./routes.tsx";

function AppInner({ projectPath, onSwitchProject }: { projectPath: string; onSwitchProject: (projectPath?: string) => void }) {
  const client = useRpc();
  const connectionState = useConnectionState();
  const wiredRef = useRef(false);
  const wireCleanupRef = useRef<(() => void) | null>(null);

  // Wire events + fetch initial data on connect
  useEffect(() => {
    console.log("[ThinkRail] Connection state:", connectionState);
    if (connectionState === "connected" && !wiredRef.current) {
      // ── Initial connect ──
      wiredRef.current = true;
      setClient(client);
      wireCleanupRef.current?.();
      wireCleanupRef.current = wireEvents(client);
      useUiStore.getState().setProject(projectPath);
      // Session loading is gated on project state: state="new" defers
      // to the welcome screen; state="initialized" also recovers the
      // most recent disk session (backend-restart case).
      validateProject(projectPath)
        .catch(() => ({ state: "initialized" as const }))
        .then((d) => {
          useUiStore.getState().setProjectState(d.state);
          const opts = sessionLoadStrategy(d.state);
          if (!opts) return;
          useSessionStore.getState()
            .loadActiveSessions(opts)
            .catch((err) => console.warn("[ThinkRail] Failed to load sessions:", err));
          useSessionStore.getState()
            .refreshSessionList()
            .catch((err) => console.warn("[ThinkRail] Failed to refresh session list:", err));
        });
      console.log("[ThinkRail] Fetching specs...");
      useSpecStore.getState().fetchSpecs().then(() => {
        console.log("[ThinkRail] Specs loaded:", useSpecStore.getState().specs.length);
      });
      useSpecStore.getState().fetchGraph();
      // Load board tickets
      useBoardStore.getState().fetchTickets();
      // Load project settings, user-scoped session defaults, runtime
      // capabilities (drives the model / permission / effort pickers), and skills.
      useSettingsStore.getState().fetchSettings();
      useSettingsStore.getState().fetchSessionDefaults();
      useRuntimeCapsStore.getState().fetchRuntimes();
      useRuntimeCapsStore.getState().fetchCapabilities("claude");
      useSettingsStore.getState().fetchSkills();
    } else if (connectionState === "connected" && wiredRef.current) {
      // ── Reconnect: WS recovered — sync session statuses immediately ──
      console.log("[ThinkRail] Reconnected — syncing session statuses");
      useSessionStore.getState().syncSessionStatuses().catch((err) => {
        console.warn("[ThinkRail] Failed to sync session statuses on reconnect:", err);
      });
    }
    if (connectionState === "disconnected" || connectionState === "failed") {
      wiredRef.current = false;
    }
  }, [connectionState, client, projectPath]);

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

  // Remember which session was active per project so a page reload picks
  // up where the user left off — instead of auto-selecting an unrelated
  // session by mtime.
  useEffect(() => {
    let prev = useSessionStore.getState().activeSessionId;
    const unsub = useSessionStore.subscribe((state) => {
      const next = state.activeSessionId;
      if (next === prev) return;
      prev = next;
      const projectPath = useUiStore.getState().projectPath;
      if (projectPath) {
        useUiStore.getState().rememberActiveSession(projectPath, next);
      }
    });
    return unsub;
  }, []);

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
    <>
      <AppRoutes onSwitchProject={onSwitchProject} />
      <ToastContainer />
    </>
  );
}

export function App({
  projectPath,
  onSwitchProject,
}: {
  projectPath: string;
  onSwitchProject: (projectPath?: string) => void;
}) {
  return <AppInner projectPath={projectPath} onSwitchProject={onSwitchProject} />;
}
