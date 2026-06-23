/** Status / state value objects — the single source of truth for the status
 *  string literals that cross the UI. Reference the members (e.g.
 *  `SessionStatus.Done`) instead of bare strings: a typo becomes a compile
 *  error and the value set has one home. Each `type` is derived from its
 *  object, so the two never drift.
 */

import type {
  TicketLifecycle as TicketLifecycleWire,
  NodeStatus as NodeStatusWire,
  RunStatus as RunStatusWire,
} from "@/types/rpc-methods.ts";

// ── Session / agent-task lifecycle ──────────────────────────────────────────
// Mirrors backend TaskStatus (app/agent/models.py). The wire type serializes
// loosely as `string`, so the frontend owns this tighter set.
export const SessionStatus = {
  Draft: "draft",
  Initializing: "initializing",
  Idle: "idle",
  Running: "running",
  Waiting: "waiting",
  Done: "done",
  Error: "error",
  Interrupted: "interrupted",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** The agent-task status set is identical to the session status set. */
export const TaskStatus = SessionStatus;
export type TaskStatus = SessionStatus;

// ── Tool / diff card UI state ───────────────────────────────────────────────
export const CardState = {
  Running: "running",
  Success: "success",
  Error: "error",
} as const;
export type CardState = (typeof CardState)[keyof typeof CardState];

// ── Visualization status (thinkrail_visualize tool) ─────────────────────────
export const VisStatus = {
  Done: "done",
  Current: "current",
  Pending: "pending",
  Error: "error",
  Skipped: "skipped",
  Stale: "stale",
  Fresh: "fresh",
  InProgress: "in_progress",
} as const;
export type VisStatus = (typeof VisStatus)[keyof typeof VisStatus];

// ── Subsession return flow ──────────────────────────────────────────────────
export const SessionReturnStatus = {
  Pending: "pending",
  Approved: "approved",
  Dismissed: "dismissed",
} as const;
export type SessionReturnStatus = (typeof SessionReturnStatus)[keyof typeof SessionReturnStatus];

// ── Outcome action state ────────────────────────────────────────────────────
export const TicketActionState = {
  Pending: "pending",
  Applied: "applied",
} as const;
export type TicketActionState = (typeof TicketActionState)[keyof typeof TicketActionState];

// ── Board node / run status ─────────────────────────────────────────────────
// Hand-written mirrors of the generated wire unions (rpc-methods.ts is
// generated — DO NOT EDIT). The drift guards below fail to compile if a mirror
// ever diverges from its wire union after regeneration.
export const NodeStatus = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export const RunStatus = {
  Running: "running",
  Done: "done",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

/** Coarse 4-value ticket lifecycle derived from its stage statuses. */
export const TicketLifecycle = {
  Created: "created",
  Design: "design",
  Implementation: "implementation",
  Done: "done",
} as const;
export type TicketLifecycle = (typeof TicketLifecycle)[keyof typeof TicketLifecycle];

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** Drift guards — exported so tsc treats them as used; fail to compile if a
 *  mirror diverges from its generated wire union after `npm run generate`. */
export type NodeStatusMatchesWire = Expect<Equal<NodeStatus, NodeStatusWire>>;
export type RunStatusMatchesWire = Expect<Equal<RunStatus, RunStatusWire>>;
export type TicketLifecycleMatchesWire = Expect<Equal<TicketLifecycle, TicketLifecycleWire>>;

// ── Predicates ──────────────────────────────────────────────────────────────
// The functions are the call-site API; the Sets are private building blocks
// (used to compose/define, never tested against directly at call sites).
const TERMINAL_SESSION = new Set<SessionStatus>([SessionStatus.Done, SessionStatus.Error]);
const ENDED_SESSION = new Set<SessionStatus>([...TERMINAL_SESSION, SessionStatus.Interrupted]);
const STREAMING_SESSION = new Set<SessionStatus>([SessionStatus.Running, SessionStatus.Waiting]);
const QUIESCENT_SESSION = new Set<SessionStatus>([SessionStatus.Initializing, SessionStatus.Idle]);
const TRANSIENT_SESSION = new Set<SessionStatus>([SessionStatus.Initializing, SessionStatus.Running, SessionStatus.Waiting]);

/** Session reached a final outcome (done or error). */
export const isTerminal = (s: SessionStatus): boolean => TERMINAL_SESSION.has(s);
/** Session has no live runner — finished or interrupted (done, error, interrupted). */
export const isEnded = (s: SessionStatus): boolean => ENDED_SESSION.has(s);
/** Session is actively in a turn — interruptible (running or waiting). */
export const isStreaming = (s: SessionStatus): boolean => STREAMING_SESSION.has(s);
/** Session is between turns — ready to accept a message (initializing or idle). */
export const isQuiescent = (s: SessionStatus): boolean => QUIESCENT_SESSION.has(s);
/** Session is in-flight — a runner is expected (initializing, running, waiting). */
export const isTransient = (s: SessionStatus): boolean => TRANSIENT_SESSION.has(s);

const TERMINAL_NODE = new Set<NodeStatus>([NodeStatus.Done, NodeStatus.Failed]);
const STARTED_NODE = new Set<NodeStatus>([NodeStatus.Running, NodeStatus.Done]);

/** Stage/node reached a final state (done or failed). `WorkNode.status` is optional, so undefined is accepted (and is neither terminal nor started). */
export const isNodeTerminal = (s: NodeStatus | undefined): boolean => s != null && TERMINAL_NODE.has(s);
/** Stage/node is running or already done. */
export const isNodeStarted = (s: NodeStatus | undefined): boolean => s != null && STARTED_NODE.has(s);
