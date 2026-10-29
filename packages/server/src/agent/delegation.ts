import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	buildSessionContext,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	type DelegationRunStatus,
	isTranscriptMessageRole,
	type ThinkingLevel,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ChildHandle,
	createDelegationService,
	type DelegationService,
	delegationSessionDir,
	deriveChildSessionFile,
	type RunStatus,
} from "pi-delegation";
import { createSubagents, type Subagents } from "pi-subagents";
import { dataDir } from "../persistence";
import {
	buildSessionSettings,
	canUseSessionResources,
	liveParentContext,
	recordSessionUsage,
	scheduleSessionStatePublish,
} from "./agentSessionManager";
import { archiveSubagentRun, publishSessionResourcesChanged } from "./chatResources";
import { childBaseExtensionFactories, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";
import { isHostResourceId, isPiSessionId } from "./resourceIdentity";
import {
	createRunUsageRecorder,
	reconcileSubagentUsage,
	SUBAGENT_USAGE_KIND,
	type SubagentUsage,
} from "./subagentUsage";

export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

const services = new Map<string, DelegationService>();
let concurrencyResolver: ((workspaceId: string) => number) | undefined;

export function setSubagentConcurrencyResolver(resolver: (workspaceId: string) => number): void {
	concurrencyResolver = resolver;
}

export function refreshSubagentConcurrency(workspaceId?: string): void {
	if (!concurrencyResolver) return;
	for (const [id, service] of services) {
		if (workspaceId === undefined || id === workspaceId) {
			service.setMaxConcurrentPerParent(concurrencyResolver(id));
		}
	}
}

function recordSubagentUsage(parentSessionId: string, usage: SubagentUsage): boolean {
	return recordSessionUsage(parentSessionId, {
		kind: SUBAGENT_USAGE_KIND,
		provider: usage.provider,
		model: usage.model,
		usage: usage.usage,
		note: usage.childSessionId,
	});
}

const runUsage = createRunUsageRecorder(recordSubagentUsage);

export function reconcileSessionSubagentUsage(
	workspaceId: string,
	parentSessionId: string,
	entries: () => readonly SessionEntry[] | undefined,
): Promise<void> {
	return reconcileSubagentUsage({
		dir: delegationSessionDir(delegationRootDir(), workspaceId, parentSessionId),
		entries,
		isLive: (childSessionId) => {
			const status = services.get(workspaceId)?.findChild(childSessionId)?.snapshot?.status;
			return status === "queued" || status === "running";
		},
		record: (usage) => recordSubagentUsage(parentSessionId, usage),
	});
}

export function delegationServiceFor(workspaceId: string): DelegationService {
	let service = services.get(workspaceId);
	if (!service) {
		const maxConcurrentPerParent = concurrencyResolver?.(workspaceId);
		const created = createDelegationService({
			...(maxConcurrentPerParent === undefined ? {} : { maxConcurrentPerParent }),
			resolveParent: (sessionId) =>
				canUseSessionResources(sessionId, workspaceId) ? liveParentContext(sessionId) : undefined,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			childBaseExtensionFactories: childBaseExtensionFactories(),
			childExtensionFactories: childExtensionFactories(),
			buildChildSettings: buildSessionSettings,
		});
		created.onLifecycle((event) => {
			if (event.type === "run-progress") {
				runUsage.progress(event.parentSessionId, event.sessionId, event.details);
				return;
			}
			if (event.type === "run-terminal")
				runUsage.terminal(event.parentSessionId, event.sessionId, event.outcome.details);
			if (services.get(workspaceId) === created) archiveSubagentRun(workspaceId, created, event);
			const parentSessionId =
				event.type === "child-created" ? event.record.parentSessionId : event.parentSessionId;
			if (canUseSessionResources(parentSessionId, workspaceId)) {
				publishSessionResourcesChanged(workspaceId, parentSessionId);
				scheduleSessionStatePublish(parentSessionId);
			}
		});
		services.set(workspaceId, created);
		service = created;
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

function liveSessionChildren(workspaceId: string, parentSessionId: string): ChildHandle[] {
	return (services.get(workspaceId)?.childrenOf(parentSessionId) ?? []).filter(
		(child) =>
			child.record.scope === workspaceId &&
			child.record.parentSessionId === parentSessionId &&
			(child.snapshot?.status === "queued" || child.snapshot?.status === "running"),
	);
}

export function hasLiveSessionChildren(workspaceId: string, parentSessionId: string): boolean {
	return liveSessionChildren(workspaceId, parentSessionId).length > 0;
}

/** Cancellation lands synchronously; `settled` resolves once every child's run has actually ended. */
export function stopSessionChildren(
	workspaceId: string,
	parentSessionId: string,
	reason: string,
): { stopped: number; settled: Promise<void> } {
	const children = liveSessionChildren(workspaceId, parentSessionId);
	const settled = Promise.allSettled(
		children.map((child) => child.abort(reason).catch(() => child.dispose())),
	).then(() => {});
	return { stopped: children.length, settled };
}

export const INTERRUPTED_ABORT_REASON = "interrupted";

export async function disposeSessionChildren(
	workspaceId: string,
	parentSessionId: string,
): Promise<void> {
	const service = services.get(workspaceId);
	if (!service) return;
	for (const child of service.childrenOf(parentSessionId))
		void child.abort(INTERRUPTED_ABORT_REASON).catch(() => {});
	await service.disposeChildrenOf(parentSessionId);
}

export function removeWorkspaceDelegation(workspaceId: string): void {
	services.delete(workspaceId);
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
			{ sessionId: childSessionId },
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
