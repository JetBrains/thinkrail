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
import { buildSessionSettings, liveParentContext } from "./agentSessionManager";
import { type BundledExtensionFactory, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";

export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

const services = new Map<string, DelegationService>();

export function delegationServiceFor(workspaceId: string): DelegationService {
	let service = services.get(workspaceId);
	if (!service) {
		service = createDelegationService({
			resolveParent: liveParentContext,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			settingsManager: (cwd) => buildSessionSettings(cwd),
			childExtensionFactories: childExtensionFactories(),
		});
		services.set(workspaceId, service);
	}
	return service;
}

export function subagentsExtensionFor(workspaceId: string): BundledExtensionFactory {
	return createSubagentsExtension({
		service: delegationServiceFor(workspaceId),
		delegationRoot: delegationRootDir(),
		scope: workspaceId,
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
	const status = services.get(workspaceId)?.findChild(childSessionId)?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}

function liveChild(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): ChildHandle | undefined {
	const child = services.get(workspaceId)?.findChild(childSessionId);
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

export async function sweepUndeliveredCompletions(
	workspaceId: string,
	parentSessionId: string,
	session: AgentSession,
): Promise<void> {
	const service = services.get(workspaceId);
	if (!service || session.agent.hasQueuedMessages()) return;
	const children = service.childrenOf(parentSessionId);
	if (children.length === 0) return;
	const messages = session.messages;
	for (const child of children) {
		const snapshot = child.snapshot;
		if (!snapshot || !TERMINAL_RUN_STATUSES.has(snapshot.status) || snapshot.collected) continue;
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
