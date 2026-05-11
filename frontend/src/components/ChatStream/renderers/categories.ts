import type { EventType } from "@/types/agent.ts";

/**
 * Visibility categories for chat events.  Drives the show/hide toggles
 * in SessionStatusLine — e.g., a user can pick "Dialog only" to get a
 * clean transcript (mock-up: mockups/onboarding/new-project-session.html).
 */
export type EventCategory = "dialog" | "tools" | "system";

/** Default classification for every known event type. */
export const EVENT_CATEGORIES: Record<EventType, EventCategory> = {
  // Dialog — what the user and agent actually say to each other,
  // plus errors (they break the conversation — too critical to hide).
  userMessage: "dialog",
  textDelta: "dialog",
  askUserQuestion: "dialog",
  suggestSession: "dialog",
  suggestDescription: "dialog",
  error: "dialog",

  // Tools — agent's mechanical work: config (model, system prompt),
  // tool calls, sub-agents, visualizations.  Hide for a pure
  // conversation view.
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
};
