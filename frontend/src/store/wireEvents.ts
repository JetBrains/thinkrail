import type { RpcClient } from "@/api/client.ts";
import { useSpecStore } from "./specStore.ts";
import { useSessionStore } from "./sessionStore.ts";
import { useNotificationStore } from "./notificationStore.ts";
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
    "agent/permissionDenied",
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
  unsubs.push(
    client.on("agent/done", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onSessionDone(params);
      useNotificationStore.getState().addToast({
        taskId: params.taskId as string,
        eventType: "success",
        message: "Session completed",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(params.taskId as string, {
        type: "done",
        pulsing: false,
      });
    }),
  );
  unsubs.push(
    client.on("agent/error", (p) => {
      const params = p as Record<string, unknown>;
      useSessionStore.getState().onSessionError(params);
      useNotificationStore.getState().addToast({
        taskId: params.taskId as string,
        eventType: "error",
        message: "Session error",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(params.taskId as string, {
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
      const taskId = params.taskId as string;
      useSessionStore.getState().onAskQuestion(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        taskId,
        eventType: "question",
        message: "Agent has a question",
        persistent: false,
      });
      useNotificationStore.getState().setBadge(taskId, {
        type: "question",
        pulsing: true,
      });
    }),
  );

  unsubs.push(
    client.on("agent/confirmAction", (p) => {
      const params = p as Record<string, unknown>;
      const taskId = params.taskId as string;
      useSessionStore.getState().onConfirmAction(params);
      useNotificationStore.getState().incrementPendingInput();
      useNotificationStore.getState().addToast({
        taskId,
        eventType: "approval",
        message: `Approve: ${(params.toolName as string) ?? "action"}`,
        persistent: false,
      });
      useNotificationStore.getState().setBadge(taskId, {
        type: "approval",
        pulsing: true,
      });
    }),
  );

  return () => unsubs.forEach((u) => u());
}
