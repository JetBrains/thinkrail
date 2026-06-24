/** WS event-type names — the `eventType` discriminant carried by every
 *  AgentEvent. Reference the members (e.g. `EventType.ToolCallStart`) instead
 *  of bare strings. The drift guard below keeps this object in sync with the
 *  generated `EventType` union in types/agent.ts.
 */

import type { EventType as EventTypeWire } from "@/types/agent.ts";

export const EventType = {
  SessionStart: "sessionStart",
  TextDelta: "textDelta",
  ToolCallStart: "toolCallStart",
  ToolCallEnd: "toolCallEnd",
  SubagentStart: "subagentStart",
  SubagentEnd: "subagentEnd",
  Compact: "compact",
  Progress: "progress",
  Notification: "notification",
  PermissionDenied: "permissionDenied",
  Ready: "ready",
  TurnComplete: "turnComplete",
  Interrupted: "interrupted",
  Error: "error",
  Done: "done",
  AskUserQuestion: "askUserQuestion",
  ConfirmAction: "confirmAction",
  SuggestSession: "suggestSession",
  SuggestDescription: "suggestDescription",
  SuggestStep: "suggestStep",
  RequestResolved: "requestResolved",
  RequestExpired: "requestExpired",
  UserMessage: "userMessage",
  SetPreviewFile: "setPreviewFile",
  ClearPreviewFile: "clearPreviewFile",
  ArtifactAdded: "artifactAdded",
  ArtifactLabeled: "artifactLabeled",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** Drift guard — exported so tsc treats it as used; fails to compile if this
 *  object diverges from the generated EventType union. */
export type EventTypeMatchesUnion = Expect<Equal<EventType, EventTypeWire>>;
