import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/types/agent.ts";
import type { SessionStatus, SessionMetrics } from "@/types/session.ts";
import { useRpc } from "./useRpc.tsx";

const AGENT_METHODS = [
  "agent/sessionStart",
  "agent/textDelta",
  "agent/toolCallStart",
  "agent/toolCallEnd",
  "agent/subagentStart",
  "agent/subagentEnd",
  "agent/notification",
  "agent/compact",
  "agent/progress",
  "agent/done",
  "agent/error",
  "agent/permissionDenied",
] as const;

function emptyMetrics(): SessionMetrics {
  return {
    costUsd: 0,
    turns: 0,
    toolCalls: 0,
    contextTokens: 0,
    contextMax: 0,
    durationMs: 0,
    filesChanged: {},
  };
}

export function useSession(taskId: string | null) {
  const client = useRpc();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState<SessionStatus>("running");
  const [metrics, setMetrics] = useState<SessionMetrics>(emptyMetrics);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (!taskId) return;

    setEvents([]);
    setStatus("running");
    setMetrics(emptyMetrics());
    startTime.current = Date.now();

    const unsubs = AGENT_METHODS.map((method) =>
      client.on(method, (params: unknown) => {
        const p = params as Record<string, unknown>;
        if (p.bonsaiSid !== taskId) return;

        const event: AgentEvent = {
          bonsaiSid: p.bonsaiSid as string,
          sessionId: (p.sessionId as string) ?? "",
          eventType: method.replace("agent/", "") as AgentEvent["eventType"],
          payload: p,
        };

        setEvents((prev) => [...prev, event]);

        // Update metrics
        setMetrics((prev) => {
          const next = { ...prev };
          next.durationMs = Date.now() - startTime.current;

          if (method === "agent/toolCallEnd") {
            next.toolCalls++;
          } else if (method === "agent/textDelta") {
            next.turns++;
          }

          return next;
        });

        // Update status
        if (method === "agent/done") {
          setStatus("done");
          setMetrics((prev) => ({
            ...prev,
            costUsd: (p.costUsd as number) ?? prev.costUsd,
            durationMs: (p.durationMs as number) ?? prev.durationMs,
          }));
        } else if (method === "agent/error") {
          setStatus("error");
        }
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [client, taskId]);

  return { events, status, metrics };
}
