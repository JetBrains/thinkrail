import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	type DelegationRunStatus,
	isTranscriptMessageRole,
	type ThinkingLevel,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	createDelegationService,
	type DelegationService,
	deriveChildSessionFile,
	type RunStatus,
} from "pi-delegation";
import { createSubagents, type Subagents } from "pi-subagents";
import { dataDir } from "../persistence";
import {
	buildSessionSettings,
	canUseSessionResources,
	liveParentContext,
} from "./agentSessionManager";
import { publishSessionResourcesChanged } from "./chatResources";
import { childBaseExtensionFactories, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";
import { isHostResourceId, isPiSessionId } from "./resourceIdentity";

export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

const services = new Map<string, DelegationService>();
const activeRuns = new Map<string, Set<string>>();

export function hasActiveDelegation(workspaceId: string): boolean {
	return (activeRuns.get(workspaceId)?.size ?? 0) > 0;
}

export function delegationServiceFor(workspaceId: string): DelegationService {
	let service = services.get(workspaceId);
	if (!service) {
		service = createDelegationService({
			resolveParent: (sessionId) =>
				canUseSessionResources(sessionId, workspaceId) ? liveParentContext(sessionId) : undefined,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			childBaseExtensionFactories: childBaseExtensionFactories(),
			childExtensionFactories: childExtensionFactories(),
			buildChildSettings: buildSessionSettings,
		});
		service.onLifecycle((event) => {
			if (event.type === "run-queued" || event.type === "run-started") {
				let running = activeRuns.get(workspaceId);
				if (!running) {
					running = new Set();
					activeRuns.set(workspaceId, running);
				}
				running.add(event.sessionId);
			} else if (event.type === "run-terminal" || event.type === "child-disposed") {
				const running = activeRuns.get(workspaceId);
				running?.delete(event.sessionId);
				if (running?.size === 0) activeRuns.delete(workspaceId);
			}
			const parentSessionId =
				event.type === "child-created" ? event.record.parentSessionId : event.parentSessionId;
			if (canUseSessionResources(parentSessionId, workspaceId))
				publishSessionResourcesChanged(workspaceId, parentSessionId);
		});
		services.set(workspaceId, service);
	}
	return service;
}

export function subagentsFor(
	workspaceId: string,
	isEnabled: () => boolean,
	canDeliverCompletion: () => boolean,
): Subagents {
	return createSubagents({
		service: delegationServiceFor(workspaceId),
		delegationRoot: delegationRootDir(),
		scope: workspaceId,
		isEnabled,
		canDeliverCompletion,
	});
}

export async function disposeSessionChildren(
	workspaceId: string,
	parentSessionId: string,
): Promise<void> {
	await services.get(workspaceId)?.disposeChildrenOf(parentSessionId);
}

export function removeWorkspaceDelegation(workspaceId: string): void {
	services.delete(workspaceId);
	activeRuns.delete(workspaceId);
	rmSync(join(delegationRootDir(), workspaceId), { recursive: true, force: true });
}

function assertWorkspaceStorageId(value: string): void {
	if (!isHostResourceId(value)) throw new Error("Invalid workspaceId: not a plain id");
}

function assertSessionId(value: string, label: string): void {
	if (!isPiSessionId(value)) throw new Error(`Invalid ${label}: not a Pi session id`);
}

export function readChildTranscript(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): { messages: TranscriptMessage[]; status?: DelegationRunStatus } {
	assertWorkspaceStorageId(workspaceId);
	assertSessionId(parentSessionId, "parentSessionId");
	assertSessionId(childSessionId, "childSessionId");
	const path = deriveChildSessionFile(
		delegationRootDir(),
		workspaceId,
		parentSessionId,
		childSessionId,
	);
	const child = services.get(workspaceId)?.findChild(childSessionId);
	const ownedChild = child?.record.parentSessionId === parentSessionId ? child : undefined;
	if (!path) {
		if (ownedChild) return { messages: [], status: ownedChild.snapshot?.status ?? "queued" };
		throw new CodedError(
			"SUBAGENT_TRANSCRIPT_NOT_FOUND",
			`No transcript found for subagent session ${childSessionId}`,
		);
	}
	const sessionManager = SessionManager.open(path);
	const messages = buildSessionContext(sessionManager.getEntries()).messages.filter((message) =>
		isTranscriptMessageRole(message.role),
	) as TranscriptMessage[];
	const status = ownedChild?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}

export interface ReviewSubagentRun {
	childSessionId: string;
	status: RunStatus;
	finalText?: string;
}

/**
 * Spawn the plan-review subagent as a hidden, ephemeral delegation child (V1: hidden + fresh + explicit
 * session), await its run, and dispose it. The child runs with OUR reviewer role (systemPrompt + tool set)
 * plus the reviewer profile — project context files + child extensions (spec tools) — so it follows
 * repository guidance, and returns its final text; the host parses the structured verdict from it.
 * See submodule-server-host-plan-review.
 */
export async function runReviewSubagent(
	workspaceId: string,
	parentSessionId: string,
	task: string,
	role: {
		systemPrompt: string;
		tools: string[];
		model?: { provider: string; id: string };
		thinkingLevel?: ThinkingLevel;
	},
	signal?: AbortSignal,
): Promise<ReviewSubagentRun> {
	const child = await delegationServiceFor(workspaceId).createChild({
		parent: parentSessionId,
		info: { createdBy: "tool:request_review", roleName: "plan-reviewer" },
		visibility: "hidden",
		session: {
			systemPrompt: role.systemPrompt,
			tools: role.tools,
			extensions: true,
			contextFiles: true,
			...(role.model ? { model: role.model } : {}),
			...(role.thinkingLevel ? { thinkingLevel: role.thinkingLevel } : {}),
		},
	});
	try {
		const outcome = await child.runQueued(task, signal ? { signal } : {});
		return {
			childSessionId: child.sessionId,
			status: outcome.status,
			...(outcome.finalText !== undefined ? { finalText: outcome.finalText } : {}),
		};
	} finally {
		await child.dispose().catch(() => {});
	}
}
