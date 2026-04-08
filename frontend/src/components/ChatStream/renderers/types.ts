import type { ReactNode } from "react";
import type { AgentEvent, EventType } from "@/types/agent.ts";
import type { Session } from "@/types/session.ts";
import type { ToolState } from "../ChatStream.tsx";

/** Approval state linked to a tool call by sequence matching in pre-scan. */
export interface ApprovalInfo {
  requestId: string;
  answered: boolean;
  decision?: "approve" | "deny";
  interrupted?: boolean;
  toolInput?: unknown;
  description?: string;
}

/** Shared context passed to every event renderer function. */
export interface EventRenderContext {
  toolStates: Map<string, ToolState>;
  activeSubagents: Set<string>;
  subagentChildren: Map<number, number[]>;
  latestVisByVisId: Map<string, number>;
  approvalByToolIndex: Map<number, ApprovalInfo>;
  answeredRequests: Map<string, unknown>;
  onResolveRequest: (requestId: string, response: unknown) => void;
  session?: Session;
  events: AgentEvent[];
  onContextCardVisibility?: (visible: boolean) => void;
  onApplyDescription?: (text: string) => void;
}

/** A function that renders a single event, or returns null to skip it. */
export type EventRenderer = (
  event: AgentEvent,
  index: number,
  key: string,
  ctx: EventRenderContext,
) => ReactNode | null;

/** Partial map from event type to renderer — unspecified types fall back to classic. */
export type ViewRenderers = Partial<Record<EventType, EventRenderer>>;
