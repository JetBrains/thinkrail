// ThinkRail's embedding of the portable delegation core (pi-delegation) + subagents layer
// (pi-subagents): the host binds what only it knows — the delegation storage root under the
// ThinkRail data dir, the workspace id as the storage scope, the manager's live-parent projection,
// and the shared ModelRuntime — and hands the bound service to the subagents extension factory
// each session loads. One service per workspace (the scope binding is service-wide), cached.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { DelegationRunStatus, TranscriptMessage } from "@thinkrail/contracts";
import {
	createDelegationService,
	type DelegationService,
	deriveChildSessionFile,
} from "pi-delegation";
import { createSubagentsExtension } from "pi-subagents";
import { dataDir } from "../persistence";
import { liveParentContext } from "./agentSessionManager";
import { type BundledExtensionFactory, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";

/** The host's delegation storage root — hidden children live here, never pi's sessions root. */
export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

const services = new Map<string, DelegationService>();

/** The workspace's delegation service (scope = workspaceId), created on first use and cached. */
export async function delegationServiceFor(workspaceId: string): Promise<DelegationService> {
	let service = services.get(workspaceId);
	if (!service) {
		service = createDelegationService({
			resolveParent: liveParentContext,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: await getPiRuntime(),
			// The curated set a child MAY load (`extensions: true` in its definition): spec-graph (the
			// spec-first read tools) + web-access under the same headless-search guard the parent runs.
			// Deliberately NOT the parent's full set: ask_user_question would hang a hidden
			// non-interactive child, and visualize/todos add nothing to a text report. Future LISTED
			// interactive children (subsessions) are first-class manager sessions assembled by
			// `createSession` itself — they get everything, and never pass through this set.
			childExtensionFactories: childExtensionFactories(),
		});
		services.set(workspaceId, service);
	}
	return service;
}

/** The subagents extension bound to the workspace's service — appended to every session's loader. */
export async function subagentsExtensionFor(workspaceId: string): Promise<BundledExtensionFactory> {
	return createSubagentsExtension({
		service: await delegationServiceFor(workspaceId),
		delegationRoot: delegationRootDir(),
		scope: workspaceId,
	});
}

/**
 * The dispose cascade — the manager calls it whenever a parent session leaves the manager (tab
 * close, shutdown, workspace archival). Fire-and-forget-safe: an unknown workspace or a parent
 * with no children is a no-op.
 */
export async function disposeSessionChildren(
	workspaceId: string,
	parentSessionId: string,
): Promise<void> {
	await services.get(workspaceId)?.disposeChildrenOf(parentSessionId);
}

/**
 * Workspace archival: drop the service and delete the workspace's delegation store (retention is
 * the embedder's — task-spec Storage & lineage). The manager removes the workspace's sessions
 * FIRST, and each removal cascades `disposeSessionChildren` — so by this point no live child
 * remains and deleting the scope dir reaps only files.
 */
export function removeWorkspaceDelegation(workspaceId: string): void {
	services.delete(workspaceId);
	rmSync(join(delegationRootDir(), workspaceId), { recursive: true, force: true });
}

/**
 * The three transcript-read keys arrive as raw wire strings and become path segments under the
 * delegation root — reject anything that could traverse out of it (defense in depth behind the
 * handler's workspace validation; ids are opaque slugs/UUIDs, never path-like).
 */
function assertPathSegment(value: string, label: string): void {
	if (value.length === 0 || value.includes("/") || value.includes("\\") || value.includes("..")) {
		throw new Error(`Invalid ${label}: not a plain id`);
	}
}

/**
 * A hidden child's transcript, read from the delegation store (`subagent.getTranscript`): works
 * while the run streams, after completion, and after a host restart (the in-memory registry is
 * lost then; the transcript is not). Read-only — children are driven only through the parent's
 * `Agent` tool. Throws when no transcript exists for the triple. `status` is the run's current
 * registry status — present only while this host still knows the run (absent after a restart or
 * dispose): the client's poll-while-live signal.
 */
export function readChildTranscript(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): { messages: TranscriptMessage[]; status?: DelegationRunStatus } {
	assertPathSegment(workspaceId, "workspaceId");
	assertPathSegment(parentSessionId, "parentSessionId");
	assertPathSegment(childSessionId, "childSessionId");
	const path = deriveChildSessionFile(
		delegationRootDir(),
		workspaceId,
		parentSessionId,
		childSessionId,
	);
	if (!path) {
		throw new Error(`No transcript found for subagent session ${childSessionId}`);
	}
	const sessionManager = SessionManager.open(path);
	const renderable = new Set(["user", "assistant", "toolResult", "custom"]);
	const messages: TranscriptMessage[] = [];
	for (const entry of sessionManager.getEntries()) {
		if (entry.type === "message" && renderable.has(entry.message.role)) {
			messages.push(entry.message as TranscriptMessage);
		}
	}
	const status = services.get(workspaceId)?.findChild(childSessionId)?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}
