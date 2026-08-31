import { rmSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentSession,
	buildSessionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	type DelegationRunStatus,
	isDelegationRunDetails,
	isSubagentCompletionMessage,
	isTranscriptMessageRole,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ChildHandle,
	createDelegationService,
	type DelegationService,
	deriveChildSessionFile,
	type RunStatus,
} from "pi-delegation";
import { boundedText, createSubagentsExtension, SUBAGENT_COMPLETION_MESSAGE } from "pi-subagents";
import { dataDir } from "../persistence";
import {
	buildSessionSettings,
	liveParentContext,
	liveParentSessionForDelegation,
} from "./agentSessionManager";
import { type BundledExtensionFactory, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";

export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

interface CompletionSweepFlight {
	requested: boolean;
	promise: Promise<void>;
}

interface WorkspaceDelegationState {
	service: DelegationService;
	quiescedParents: Map<string, number>;
	completionSweeps: Map<string, CompletionSweepFlight>;
}

const delegations = new Map<string, WorkspaceDelegationState>();

function createWorkspaceDelegationState(workspaceId: string): WorkspaceDelegationState {
	return {
		service: createDelegationService({
			resolveParent: liveParentContext,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			settingsManager: (cwd) => buildSessionSettings(cwd),
			childExtensionFactories: childExtensionFactories(),
		}),
		quiescedParents: new Map(),
		completionSweeps: new Map(),
	};
}

function delegationStateFor(workspaceId: string): WorkspaceDelegationState {
	let state = delegations.get(workspaceId);
	if (!state) {
		state = createWorkspaceDelegationState(workspaceId);
		delegations.set(workspaceId, state);
	}
	return state;
}

function isParentQuiesced(state: WorkspaceDelegationState, parentSessionId: string): boolean {
	return (state.quiescedParents.get(parentSessionId) ?? 0) > 0;
}

export function delegationServiceFor(workspaceId: string): DelegationService {
	return delegationStateFor(workspaceId).service;
}

export function subagentsExtensionFor(workspaceId: string): BundledExtensionFactory {
	const state = delegationStateFor(workspaceId);
	return createSubagentsExtension({
		service: state.service,
		delegationRoot: delegationRootDir(),
		scope: workspaceId,
		isParentQuiesced: (parentSessionId) => isParentQuiesced(state, parentSessionId),
		deliverBackgroundCompletion: ({ parentSessionId }) => {
			const session = liveParentSessionForDelegation(parentSessionId);
			return session
				? sweepUndeliveredCompletions(workspaceId, parentSessionId, session)
				: undefined;
		},
	});
}

export function quiesceParentDelegation(workspaceId: string, parentSessionId: string): () => void {
	const state = delegations.get(workspaceId);
	if (!state) return () => {};
	state.quiescedParents.set(parentSessionId, (state.quiescedParents.get(parentSessionId) ?? 0) + 1);
	let active = true;
	return () => {
		if (!active || delegations.get(workspaceId) !== state) return;
		active = false;
		const remaining = (state.quiescedParents.get(parentSessionId) ?? 1) - 1;
		if (remaining > 0) state.quiescedParents.set(parentSessionId, remaining);
		else state.quiescedParents.delete(parentSessionId);
	};
}

export async function disposeSessionChildren(
	workspaceId: string,
	parentSessionId: string,
): Promise<void> {
	await delegations.get(workspaceId)?.service.disposeChildrenOf(parentSessionId);
}

export function removeWorkspaceDelegation(workspaceId: string): void {
	delegations.delete(workspaceId);
	rmSync(join(delegationRootDir(), workspaceId), { recursive: true, force: true });
}

function assertPathSegment(value: string, label: string): void {
	if (value.length === 0 || value.includes("/") || value.includes("\\") || value.includes("..")) {
		throw new Error(`Invalid ${label}: not a plain id`);
	}
}

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
		const child = liveChild(workspaceId, parentSessionId, childSessionId);
		if (!child) {
			throw new CodedError(
				"SUBAGENT_TRANSCRIPT_NOT_FOUND",
				`No transcript found for subagent session ${childSessionId}`,
			);
		}
		const status = child.snapshot?.status;
		return { messages: [], ...(status !== undefined ? { status } : {}) };
	}
	const sessionManager = SessionManager.open(path);
	const messages = buildSessionContext(sessionManager.getEntries()).messages.filter((message) =>
		isTranscriptMessageRole(message.role),
	) as TranscriptMessage[];
	const status = delegations.get(workspaceId)?.service.findChild(childSessionId)?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}

function liveChild(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): ChildHandle | undefined {
	const child = delegations.get(workspaceId)?.service.findChild(childSessionId);
	return child && child.record.parentSessionId === parentSessionId ? child : undefined;
}

export async function abortChildRun(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): Promise<void> {
	const child = liveChild(workspaceId, parentSessionId, childSessionId);
	if (!child) {
		throw new CodedError(
			"SUBAGENT_TRANSCRIPT_NOT_FOUND",
			`No live run found for subagent session ${childSessionId}`,
		);
	}
	await child.abort();
}

const TERMINAL_RUN_STATUSES = new Set<string>(["completed", "error", "aborted"]);

function isNonTerminalBackgroundAck(details: unknown, childSessionId: string): boolean {
	return (
		isDelegationRunDetails(details) &&
		details.childSessionId === childSessionId &&
		(details.status === "queued" || details.status === "running")
	);
}

function canSweepUndeliveredCompletions(
	workspaceId: string,
	parentSessionId: string,
	session: AgentSession,
	state: WorkspaceDelegationState,
): boolean {
	return (
		delegations.get(workspaceId) === state &&
		!isParentQuiesced(state, parentSessionId) &&
		liveParentSessionForDelegation(parentSessionId) === session &&
		!session.isStreaming &&
		!session.agent.hasQueuedMessages()
	);
}

async function sweepUndeliveredCompletionsOnce(
	workspaceId: string,
	parentSessionId: string,
	session: AgentSession,
	state: WorkspaceDelegationState,
): Promise<void> {
	if (!canSweepUndeliveredCompletions(workspaceId, parentSessionId, session, state)) return;
	const children = state.service.childrenOf(parentSessionId);
	for (const child of children) {
		if (!canSweepUndeliveredCompletions(workspaceId, parentSessionId, session, state)) return;
		const snapshot = child.snapshot;
		if (!snapshot || !TERMINAL_RUN_STATUSES.has(snapshot.status) || snapshot.collected) continue;
		const messages = session.messages;
		const acked = messages.some(
			(message) =>
				message.role === "toolResult" &&
				isNonTerminalBackgroundAck(message.details, child.sessionId),
		);
		const delivered = messages.some(
			(message) =>
				isSubagentCompletionMessage(message) && message.details.childSessionId === child.sessionId,
		);
		if (!acked || delivered) continue;
		const status = snapshot.status as RunStatus;
		const report = boundedText({
			status,
			finalText: snapshot.finalText,
			errorMessage: snapshot.errorMessage,
		});
		if (!canSweepUndeliveredCompletions(workspaceId, parentSessionId, session, state)) return;
		await session.sendCustomMessage(
			{
				customType: SUBAGENT_COMPLETION_MESSAGE,
				content: `Subagent "${child.record.info.roleName ?? "subagent"}" (${child.sessionId}) ${status}:\n\n${report}`,
				display: true,
				details: snapshot.details,
			},
			{ triggerTurn: true },
		);
	}
}

export function sweepUndeliveredCompletions(
	workspaceId: string,
	parentSessionId: string,
	session: AgentSession,
): Promise<void> {
	const state = delegations.get(workspaceId);
	if (!state) return Promise.resolve();
	const current = state.completionSweeps.get(parentSessionId);
	if (current) {
		current.requested = true;
		return current.promise;
	}
	const flight: CompletionSweepFlight = { requested: true, promise: Promise.resolve() };
	state.completionSweeps.set(parentSessionId, flight);
	flight.promise = Promise.resolve().then(async () => {
		while (true) {
			flight.requested = false;
			let failed = false;
			let failure: unknown;
			try {
				await sweepUndeliveredCompletionsOnce(workspaceId, parentSessionId, session, state);
			} catch (error) {
				failed = true;
				failure = error;
			}
			if (flight.requested) continue;
			if (state.completionSweeps.get(parentSessionId) === flight) {
				state.completionSweeps.delete(parentSessionId);
			}
			if (failed) throw failure;
			return;
		}
	});
	return flight.promise;
}
