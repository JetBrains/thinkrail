// The one-at-a-time auth flow registry. Every long-running auth operation (an OAuth login, a
// jbcentral step) is a *flow*: it gets an id + AbortController, streams `AuthEvent`s tagged with that
// id, and ends with exactly one `done` frame. Starting any flow supersedes a still-running one (last
// click wins — the gate is a single-user surface, and a wedged flow must never block a retry).

import type { AuthFlowKind, AuthFlowStart } from "@thinkrail/contracts";
import { publishAuthEvent } from "./events";

export interface ActiveFlow {
	id: string;
	kind: AuthFlowKind;
	controller: AbortController;
}

let active: ActiveFlow | null = null;

/** The currently-running flow, if any (tests + answer routing). */
export function activeFlow(): ActiveFlow | null {
	return active;
}

/**
 * Open a new flow (aborting any previous one) and announce it. The caller runs the actual work and
 * MUST settle it via `finishFlow` on every path.
 */
export function startFlow(kind: AuthFlowKind, providerId?: string): ActiveFlow {
	if (active) active.controller.abort();
	const flow: ActiveFlow = { id: crypto.randomUUID(), kind, controller: new AbortController() };
	active = flow;
	publishAuthEvent({
		kind: "flow-started",
		flowId: flow.id,
		flow: kind,
		...(providerId ? { providerId } : {}),
	});
	return flow;
}

/** Settle a flow with its terminal `done` frame (exactly once — later calls are no-ops). */
const settled = new Set<string>();
export function finishFlow(flow: ActiveFlow, ok: boolean, message?: string): void {
	if (settled.has(flow.id)) return;
	settled.add(flow.id);
	if (settled.size > 64) {
		// Bounded memory: ids are never reused, so evicting old entries is safe.
		for (const id of settled) {
			if (settled.size <= 32) break;
			settled.delete(id);
		}
	}
	if (active?.id === flow.id) active = null;
	publishAuthEvent({ kind: "done", flowId: flow.id, ok, ...(message ? { message } : {}) });
}

/** Abort a flow by id (the `auth.cancel` handler). Unknown/finished ids are a no-op. */
export function cancelFlow(flowId: string): void {
	if (active?.id === flowId) active.controller.abort();
}

/** The `{ flowId }` wire result for a just-started flow. */
export function flowStart(flow: ActiveFlow): AuthFlowStart {
	return { flowId: flow.id };
}
