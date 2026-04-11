import type { RpcClient } from "@/api/client.ts";
import { useSpecStore } from "./specStore.ts";
import { useSessionStore } from "./sessionStore.ts";
import { useNotificationStore } from "./notificationStore.ts";
import { useUiStore } from "./uiStore.ts";
import { useFileStore } from "./fileStore.ts";
import { useVisStore } from "./visStore.ts";
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
    client.on("registry/didUpdate", () => {
      useSpecStore.getState().onRegistryUpdated();
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
      // Reload settings when .bonsai/settings.json changes on disk
      if (path === ".bonsai/settings.json") {
        useSettingsStore.getState().fetchSettings();
      }
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
  unsubs.push(
    client.on("session/didCreate", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRemoteSessionCreated(params);
    }),
  );
  unsubs.push(
    client.on("session/userMessage", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onRemoteUserMessage(params);
    }),
  );
  unsubs.push(
    client.on("agent/done", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onSessionDone(params);
      useNotificationStore.getState().addToast({
        bonsaiSid: params.bonsaiSid as string,
        eventType: "success",
        message: "Session completed",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(params.bonsaiSid as string, {
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
      const detail = errors[0] || subtype || "unknown error";
      useNotificationStore.getState().addToast({
        bonsaiSid: params.bonsaiSid as string,
        eventType: "error",
        message: isCrash ? `Session crashed: ${detail}` : `Session error: ${detail}`,
        persistent: isCrash,
      });
      useNotificationStore.getState().setBadge(params.bonsaiSid as string, {
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
      const bonsaiSid = params.bonsaiSid as string;
      useSessionStore.getState().onAskQuestion(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        bonsaiSid,
        eventType: "question",
        message: "Agent has a question",
        persistent: true,
      });
      useNotificationStore.getState().setBadge(bonsaiSid, {
        type: "question",
        pulsing: true,
      });
    }),
  );

  unsubs.push(
    client.on("agent/confirmAction", (p) => {
      const params = p as Record<string, unknown>;
      const bonsaiSid = params.bonsaiSid as string;
      useSessionStore.getState().onConfirmAction(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        bonsaiSid,
        eventType: "approval",
        message: `Approve: ${(params.toolName as string) ?? "action"}`,
        persistent: true,
      });
      useNotificationStore.getState().setBadge(bonsaiSid, {
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
      const bonsaiSid = params.bonsaiSid as string;
      useSessionStore.getState().onSuggestSession(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        bonsaiSid,
        eventType: "suggestion",
        message: "Agent suggests a new session",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(bonsaiSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Description suggestions ──
  unsubs.push(
    client.on("agent/suggestDescription", (p) => {
      const params = p as Record<string, unknown>;
      const bonsaiSid = params.bonsaiSid as string;
      useSessionStore.getState().onSuggestDescription(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        bonsaiSid,
        eventType: "suggestion",
        message: "Agent suggests a description",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(bonsaiSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Orchestrator step proposals ──
  unsubs.push(
    client.on("agent/suggestStep", (p) => {
      const params = p as Record<string, unknown>;
      const bonsaiSid = params.bonsaiSid as string;
      useSessionStore.getState().onSuggestStep(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        bonsaiSid,
        eventType: "suggestion",
        message: `Step ${params.stepNumber}: ${params.stepTitle}`,
        persistent: false,
      });
      useNotificationStore.getState().setBadge(bonsaiSid, {
        type: "suggestion",
        pulsing: true,
      });
    }),
  );

  // ── Board notifications ──
  unsubs.push(
    client.on("board/didChange", (p) => {
      useBoardStore.getState().handleDidChange(p as import("@/types/board.ts").MetaTicketSummary);
    }),
  );
  unsubs.push(
    client.on("board/didCreate", (p) => {
      useBoardStore.getState().handleDidCreate(p as import("@/types/board.ts").MetaTicketSummary);
    }),
  );
  unsubs.push(
    client.on("board/didDelete", (p) => {
      const { id } = p as { id: string };
      useBoardStore.getState().handleDidDelete(id);
    }),
  );

  // ── Visualization dashboard ──
  unsubs.push(
    client.on("vis/stateChanged", (p) => {
      useVisStore.getState().onStateChanged(p as import("./visStore.ts").DashboardState);
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
