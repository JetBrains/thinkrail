import type { RpcClient } from "@/api/client.ts";
import { isTerminal } from "@/constants/status.ts";
import { useSpecStore } from "./specStore.ts";
import { useSessionStore } from "./sessionStore.ts";
import { useNotificationStore } from "./notificationStore.ts";
import { useConnectionStore } from "./connectionStore.ts";
import { useUiStore } from "./uiStore.ts";
import { useFileStore } from "./fileStore.ts";
import { useBoardStore } from "./boardStore.ts";
import { useSettingsStore } from "./settingsStore.ts";
import type { Unsubscribe } from "@/api/types.ts";

/**
 * Wire RPC client notifications and server-initiated requests to Zustand store actions.
 * Call once at app startup after RpcClient connects. Returns cleanup function.
 *
 * NOTE: agent/askUserQuestion and agent/confirmAction arrive as server-initiated
 * requests (with JSON-RPC `id`), but the backend expects the response via the
 * `agent/respond` RPC method — NOT as a JSON-RPC response. So we handle them
 * as notifications and send the answer via `agent/respond`.
 */
export function wireEvents(client: RpcClient): Unsubscribe {
  const unsubs: Unsubscribe[] = [];

  // ── Spec notifications ──
  unsubs.push(
    client.on("spec/didChange", (p) => {
      const { id } = p as { id: string };
      useSpecStore.getState().onSpecChanged(id);
    }),
  );
  unsubs.push(
    client.on("spec/didCreate", (p) => {
      const { id, path } = p as { id: string; path: string };
      useSpecStore.getState().onSpecCreated(id, path);
    }),
  );
  unsubs.push(
    client.on("spec/didDelete", (p) => {
      const { id } = p as { id: string };
      useSpecStore.getState().onSpecDeleted(id);
    }),
  );
  unsubs.push(
    client.on("docs/didChange", () => {
      useSpecStore.getState().fetchGraph();
    }),
  );

  // ── Index ready (background init complete) ──
  unsubs.push(
    client.on("index/ready", () => {
      useSpecStore.getState().fetchSpecs();
      useSpecStore.getState().fetchGraph();
    }),
  );

  // ── File tree notifications ──
  unsubs.push(
    client.on("files/treeChanged", () => {
      useUiStore.getState().onFileTreeChanged();
    }),
  );

  // ── File content notifications ──
  unsubs.push(
    client.on("file/didChange", (p) => {
      const { path } = p as { path: string };
      useFileStore.getState().onFileChanged(path);
      // Reload settings when .tr/settings.json changes on disk
      if (path === ".tr/settings.json") {
        useSettingsStore.getState().fetchSettings();
      }
    }),
  );

  // ── Session metadata updates (outcome, etc.) ──
  unsubs.push(
    client.on("session/didUpdate", (p) => {
      const { task } = p as { task: Record<string, unknown> };
      useSessionStore.getState().onSessionMetadataUpdate(task);
    }),
  );

  // ── Agent streaming notifications ──
  const agentMethods = [
    "agent/textDelta",
    "agent/toolCallStart",
    "agent/toolCallEnd",
    "agent/turnComplete",
    "agent/interrupted",
    "agent/subagentStart",
    "agent/subagentEnd",
    "agent/notification",
    "agent/compact",
    "agent/progress",
    "agent/costEstimate",
    "agent/permissionDenied",
    "agent/ready",
    "agent/statusChanged",
  ];
  for (const method of agentMethods) {
    unsubs.push(
      client.on(method, (p) => {
        useSessionStore
          .getState()
          .onAgentEvent(method, p as Record<string, unknown>);
      }),
    );
  }

  unsubs.push(
    client.on("agent/sessionStart", (p) => {
      useSessionStore
        .getState()
        .onSessionStart(p as Record<string, unknown>);
    }),
  );

  // ── Multi-client sync notifications ──
  // A brand-new session brings name/config/createdAt that aren't on the
  // wire (the payload is minimal), so refetch the list to pull full
  // metadata. didCreate fires once per session — no need to debounce.
  unsubs.push(
    client.on("session/didCreate", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRemoteSessionCreated(params);
      void useSessionStore.getState().refreshSessionList()
        .catch(() => { /* swallow — best-effort cache update */ });
    }),
  );
  unsubs.push(
    client.on("session/userMessage", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRemoteUserMessage(params);
    }),
  );
  unsubs.push(
    client.on("session/didEnd", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      const status = params.status as string;
      if (!thinkrailSid || !status) return;
      // Update session status in the in-memory sessions Map if it exists
      const session = useSessionStore.getState().sessions.get(thinkrailSid);
      if (session && !isTerminal(session.status)) {
        const sessions = new Map(useSessionStore.getState().sessions);
        sessions.set(thinkrailSid, { ...session, status: status as typeof session.status });
        useSessionStore.setState({ sessions });
      }
      useSessionStore.getState().patchSessionInList(thinkrailSid, { status });
    }),
  );

  // agent/statusChanged fires twice per turn — patch the single affected
  // row in place instead of refetching the whole list every transition.
  unsubs.push(
    client.on("agent/statusChanged", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      const status = params.status as string;
      if (!thinkrailSid || !status) return;
      useSessionStore.getState().patchSessionInList(thinkrailSid, { status });
    }),
  );
  unsubs.push(
    client.on("agent/done", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onSessionDone(params);
      useNotificationStore.getState().addToast({
        thinkrailSid: params.thinkrailSid as string,
        eventType: "success",
        message: "Session completed",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(params.thinkrailSid as string, {
        type: "done",
        pulsing: false,
      });
    }),
  );
  unsubs.push(
    client.on("agent/error", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onSessionError(params);
      const subtype = (params.subtype as string) ?? "";
      const errors = (params.errors as string[]) ?? [];
      const isCrash = subtype === "crash";
      const isContextOverflow = subtype === "context_overflow";
      const detail = isContextOverflow
        ? "Context window full"
        : errors[0] || subtype || "unknown error";
      useNotificationStore.getState().addToast({
        thinkrailSid: params.thinkrailSid as string,
        eventType: "error",
        message: isCrash
          ? `Session crashed: ${detail}`
          : isContextOverflow
            ? "Context window full — see chat for recovery options"
            : `Session error: ${detail}`,
        persistent: isCrash,
      });
      useNotificationStore.getState().setBadge(params.thinkrailSid as string, {
        type: "error",
        pulsing: false,
      });
    }),
  );

  // ── Config changes ──
  unsubs.push(
    client.on("agent/configChanged", (p) => {
      useSessionStore
        .getState()
        .onConfigChanged(p as Record<string, unknown>);
    }),
  );

  // ── Server-initiated questions and approvals ──
  // These arrive with a JSON-RPC `id` (server-initiated request), but the
  // backend expects the answer via the `agent/respond` RPC method.
  // We handle them as notifications and store the pending request in sessionStore.
  // When the user responds (via QuestionCard or ApprovalCard), SessionPanel
  // calls sessionStore.resolveRequest() which sends `agent/respond` RPC.

  unsubs.push(
    client.on("agent/askUserQuestion", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      useSessionStore.getState().onAskQuestion(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        thinkrailSid,
        eventType: "question",
        message: "Agent has a question",
        persistent: true,
      });
      useNotificationStore.getState().setBadge(thinkrailSid, {
        type: "question",
        pulsing: true,
      });
    }),
  );

  unsubs.push(
    client.on("agent/confirmAction", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      useSessionStore.getState().onConfirmAction(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        thinkrailSid,
        eventType: "approval",
        message: `Approve: ${(params.toolName as string) ?? "action"}`,
        persistent: true,
      });
      useNotificationStore.getState().setBadge(thinkrailSid, {
        type: "approval",
        pulsing: true,
      });
    }),
  );

  // ── Request expired (timeout) ──
  unsubs.push(
    client.on("agent/requestExpired", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRequestExpired(params);
    }),
  );

  // ── Request resolved by another client (multi-client) ──
  unsubs.push(
    client.on("agent/requestResolved", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRequestResolved(params);
    }),
  );

  unsubs.push(
    client.on("agent/suggestSession", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      useSessionStore.getState().onSuggestSession(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        thinkrailSid,
        eventType: "suggestion",
        message: "Agent suggests a new session",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(thinkrailSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Description suggestions ──
  unsubs.push(
    client.on("agent/suggestDescription", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      useSessionStore.getState().onSuggestDescription(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        thinkrailSid,
        eventType: "suggestion",
        message: "Agent suggests a description",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(thinkrailSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Preview tab control (agent-driven, UI side-effect only) ──
  unsubs.push(
    client.on("ui/setPreviewFile", (p) => {
      useSessionStore.getState().onSetPreviewFile(p as Record<string, unknown>);
    }),
  );
  unsubs.push(
    client.on("ui/clearPreviewFile", (p) => {
      useSessionStore.getState().onClearPreviewFile(p as Record<string, unknown>);
    }),
  );

  // ── Per-session artifact tracking (ticket-linked sessions only) ──
  unsubs.push(
    client.on("ui/artifactAdded", (p) => {
      useSessionStore.getState().onArtifactAdded(p as Record<string, unknown>);
    }),
  );
  unsubs.push(
    client.on("ui/artifactLabeled", (p) => {
      useSessionStore.getState().onArtifactLabeled(p as Record<string, unknown>);
    }),
  );

  // ── Orchestrator step proposals ──
  unsubs.push(
    client.on("agent/suggestStep", (p) => {
      const params = p as Record<string, unknown>;
      const thinkrailSid = params.thinkrailSid as string;
      useSessionStore.getState().onSuggestStep(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        thinkrailSid,
        eventType: "suggestion",
        message: `Step ${params.stepNumber}: ${params.stepTitle}`,
        persistent: false,
      });
      useNotificationStore.getState().setBadge(thinkrailSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Subsession notifications ──
  unsubs.push(
    client.on("subsession/returned", (p) => {
      useSessionStore.getState().onSubsessionReturned(p as Record<string, unknown>);
    }),
  );

  // ── Board notifications ──
  unsubs.push(
    client.on("board/didChange", (p) => {
      useBoardStore.getState().handleDidChange(p as import("@/types/board.ts").TicketSummary);
    }),
  );
  // ticket/didChange carries a full TicketState — apply it to keep the stage
  // graph and artifact rev in sync without a round-trip.
  unsubs.push(
    client.on("ticket/didChange", (p) => {
      import("@/store/ticketStateStore.ts").then(({ useTicketStateStore }) => {
        useTicketStateStore.getState().apply(p as import("@/types/rpc-methods.ts").TicketState);
      });
    }),
  );
  unsubs.push(
    client.on("board/didCreate", (p) => {
      const params = p as import("@/types/board.ts").TicketSummary & { thinkrailSid?: string };
      useBoardStore.getState().handleDidCreate(params);
    }),
  );
  unsubs.push(
    client.on("board/didDelete", (p) => {
      const { id } = p as { id: string };
      useBoardStore.getState().handleDidDelete(id);
    }),
  );

  // ── Connection presence (multi-client) ──
  unsubs.push(
    client.on("connection/didJoin", (p) => {
      const params = p as Record<string, unknown>;
      useConnectionStore.getState().onClientJoin({
        connId: params.connId as string,
        userId: params.userId as string,
        displayName: params.displayName as string,
        connectedAt: Date.now(),
      });
    }),
  );
  unsubs.push(
    client.on("connection/didLeave", (p) => {
      const { connId } = p as { connId: string };
      useConnectionStore.getState().onClientLeave(connId);
    }),
  );

  return () => unsubs.forEach((u) => u());
}

// ── HMR: force full reload when event wiring changes ──
// Without this, editing wireEvents.ts creates a new function that's never
// called (wiredRef guard in App.tsx), while old handlers stay active with
// stale store imports.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
