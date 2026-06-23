import type { AgentEvent } from "@/types/agent.ts";
import { EventType } from "@/constants/eventTypes.ts";

/**
 * Visibility categories for chat events.  Drives the show/hide toggles
 * in SessionStatusLine — e.g., a user can pick "Dialog only" to get a
 * clean transcript (mock-up: mockups/onboarding/new-project-session.html).
 */
export type EventCategory = "dialog" | "tools" | "system";

/** Default classification by event type. */
const BASE_CATEGORIES: Record<EventType, EventCategory> = {
  // Dialog — what the user and agent actually say to each other,
  // plus errors (they break the conversation — too critical to hide).
  userMessage: "dialog",
  textDelta: "dialog",
  askUserQuestion: "dialog",
  suggestSession: "dialog",
  suggestDescription: "dialog",
  suggestStep: "dialog",
  error: "dialog",

  // Tools — agent's mechanical work: config (model, system prompt),
  // tool calls, sub-agents.  Hide for a pure conversation view.
  sessionStart: "tools",
  toolCallStart: "tools",
  toolCallEnd: "tools",
  subagentStart: "tools",
  subagentEnd: "tools",

  // System — chrome / lifecycle: completion banners, turn boundaries,
  // context compactions, permission gates, internal acks.
  ready: "system",
  turnComplete: "system",
  interrupted: "system",
  done: "system",
  compact: "system",
  progress: "system",
  confirmAction: "system",
  permissionDenied: "system",
  notification: "system",
  requestResolved: "system",
  requestExpired: "system",
  setPreviewFile: "system",
  clearPreviewFile: "system",
  artifactAdded: "system",
  artifactLabeled: "system",
};

/**
 * Classify an event for the dialog/tools/system visibility toggles.
 *
 * Mostly a lookup by eventType, but tool calls need payload inspection:
 * `thinkrail_visualize` renders artifacts (comparisons like "Architecture
 * Approaches", diagrams) that are part of the conversation, so they
 * stay visible in dialog-only mode.
 */
export function getEventCategory(event: AgentEvent): EventCategory {
  if (event.eventType === EventType.ToolCallStart || event.eventType === EventType.ToolCallEnd) {
    const toolName = event.payload.toolName;
    if (toolName && toolName.endsWith("thinkrail_visualize")) return "dialog";
  }
  return BASE_CATEGORIES[event.eventType];
}
