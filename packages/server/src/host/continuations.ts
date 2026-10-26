import { randomUUID } from "node:crypto";
import type {
	ChatContinuation,
	ChatHandoffDetails,
	ContinueInWorkspaceRequestDetails,
	PiEvent,
	Project,
	Workspace,
} from "@thinkrail/contracts";
import {
	CHAT_HANDOFF_CUSTOM_TYPE,
	CONTINUE_IN_WORKSPACE_REQUEST_CUSTOM_TYPE,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ContinueToolHost,
	createSession,
	ensureSessionAttached,
	getSessionWorkspaceId,
	listSessions,
	sendHostMessageToSession,
} from "../agent";
import { logger } from "../log";
import { listProjects } from "../projects";
import {
	createWorkspace,
	ensureWorkspaceScratchDir,
	getChatWorkspace,
	getWorkspace,
	isChatsContainer,
	recordChatContinuation,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { trackChatStarted } from "./authAnalytics";
import { provisionInitialTerminal } from "./initialTerminal";
import { resolveNewChatModel } from "./newChatModel";

const log = logger("host");

type Publisher = (continuation: ChatContinuation) => void;

interface Operation {
	state: ChatContinuation;
	project: Project;
	sourceTitle?: string;
}

const operations = new Map<string, Operation>();
const bySource = new Map<string, string>();
let publish: Publisher | null = null;

export function setContinuationPublisher(next: Publisher | null): void {
	publish = next;
}

function emit(operation: Operation, patch: Partial<ChatContinuation>): ChatContinuation {
	operation.state = { ...operation.state, ...patch };
	publish?.(operation.state);
	return operation.state;
}

function pendingFor(sessionId: string): Operation | null {
	const operationId = bySource.get(sessionId);
	const operation = operationId ? operations.get(operationId) : undefined;
	if (!operation) return null;
	const { phase } = operation.state;
	return phase === "summarizing" || phase === "creating" || phase === "started" ? operation : null;
}

function requestText(project: Project): string {
	return [
		`ThinkRail: the user asked to continue this conversation in a new workspace of the project "${project.name}".`,
		"Write a short handoff summary for the agent that will pick it up there — what was asked, what was decided, what is still open, anything it must know — then call `continue_in_workspace` with that summary. Do not do anything else in this turn.",
	].join("\n\n");
}

function handoffText(details: ChatHandoffDetails): string {
	return [
		'<handoff source="thinkrail-chat">',
		`This chat continues a chat without a project${details.sourceTitle ? ` (“${details.sourceTitle}”)` : ""}. The summary its agent wrote:`,
		"",
		details.summary,
		"",
		"Treat it as the brief; the files of the earlier chat were not copied. Continue the work here.",
		"</handoff>",
	].join("\n");
}

/** Binds one operation to the source chat and asks its agent for the summary; a busy chat queues the request. */
export async function startContinuation(
	sourceWorkspaceId: string,
	projectId: string,
): Promise<{ operationId: string }> {
	const source = getChatWorkspace(sourceWorkspaceId);
	if (source.deletionPending) {
		throw new CodedError("CHAT_WORKSPACE", "This chat is being deleted.");
	}
	const project = listProjects().find((candidate) => candidate.id === projectId);
	if (!project || isChatsContainer(project)) {
		throw new CodedError("CHATS_CONTAINER", "Pick an open project to continue in.");
	}
	const summary = (await listSessions(source.id, source.worktreePath))[0];
	if (!summary) throw new CodedError("NOT_A_CHAT", "This chat has no conversation to continue.");
	const sourceSessionId = summary.sessionId;
	const existingId = bySource.get(sourceSessionId);
	const existing = existingId ? operations.get(existingId) : undefined;
	if (
		existing &&
		(existing.state.phase === "requested" || existing.state.phase === "summarizing")
	) {
		return { operationId: existing.state.operationId };
	}
	if (
		getSessionWorkspaceId(sourceSessionId) === undefined &&
		!(await ensureSessionAttached(sourceSessionId, source.id, source.worktreePath))
	) {
		throw new CodedError("NOT_A_CHAT", "This chat's conversation could not be opened.");
	}
	const operation: Operation = {
		state: {
			operationId: randomUUID(),
			sourceWorkspaceId: source.id,
			sourceSessionId,
			projectId: project.id,
			phase: "requested",
		},
		project,
		...(summary.title ? { sourceTitle: summary.title } : {}),
	};
	operations.set(operation.state.operationId, operation);
	bySource.set(sourceSessionId, operation.state.operationId);
	publish?.(operation.state);
	const details: ContinueInWorkspaceRequestDetails = {
		operationId: operation.state.operationId,
		projectId: project.id,
		projectName: project.name,
	};
	emit(operation, { phase: "summarizing" });
	try {
		await ackSend(
			sendHostMessageToSession(
				sourceSessionId,
				CONTINUE_IN_WORKSPACE_REQUEST_CUSTOM_TYPE,
				requestText(project),
				details,
			),
		);
	} catch (error) {
		emit(operation, { phase: "failed", reason: String(error) });
		throw error;
	}
	return { operationId: operation.state.operationId };
}

export function continuationStatus(operationId: string): ChatContinuation {
	const operation = operations.get(operationId);
	if (!operation) throw new CodedError("NOT_A_CHAT", "Unknown continuation.");
	return operation.state;
}

/** The tool's host side: revalidate, create the workspace and its chat, hand the summary over, remember the link. */
export async function applyContinuation(sessionId: string, summary: string): Promise<string> {
	const operation = pendingFor(sessionId);
	if (!operation) {
		throw new Error(
			"No continuation is pending for this chat. ThinkRail asks for one with a card in the chat; if the host restarted since, the user has to ask again.",
		);
	}
	const { state } = operation;
	if (state.phase === "started" && state.workspaceId && state.sessionId) {
		return `Already continued in workspace ${state.workspaceId} (chat ${state.sessionId}).`;
	}
	const project = listProjects().find((candidate) => candidate.id === state.projectId);
	if (!project || isChatsContainer(project)) {
		emit(operation, { phase: "failed", reason: "The project is no longer open." });
		throw new Error("The project to continue in is no longer open.");
	}
	emit(operation, { phase: "creating" });
	let workspace: Workspace;
	try {
		workspace = state.workspaceId
			? getWorkspace(state.workspaceId)
			: provisionInitialTerminal(await createWorkspace(project.id));
	} catch (error) {
		emit(operation, { phase: "failed", reason: String(error) });
		throw error;
	}
	emit(operation, { workspaceId: workspace.id });
	let targetSessionId = state.sessionId;
	if (!targetSessionId) {
		try {
			ensureWorkspaceScratchDir(workspace);
			const defaults = await resolveNewChatModel({});
			const created = await createSession({
				cwd: workspace.worktreePath,
				workspaceId: workspace.id,
				...(defaults.model ? { model: defaults.model } : {}),
				thinkingLevel: defaults.thinkingLevel,
			});
			trackChatStarted({ sessionId: created.sessionId, model: created.model });
			targetSessionId = created.sessionId;
		} catch (error) {
			emit(operation, { phase: "failed", reason: String(error) });
			throw error;
		}
	}
	emit(operation, { sessionId: targetSessionId });
	const details: ChatHandoffDetails = {
		operationId: state.operationId,
		sourceWorkspaceId: state.sourceWorkspaceId,
		sourceSessionId: state.sourceSessionId,
		...(operation.sourceTitle ? { sourceTitle: operation.sourceTitle } : {}),
		summary,
	};
	let firstMessage: "sent" | "failed" = "sent";
	try {
		await ackSend(
			sendHostMessageToSession(
				targetSessionId,
				CHAT_HANDOFF_CUSTOM_TYPE,
				handoffText(details),
				details,
			),
		);
	} catch (error) {
		firstMessage = "failed";
		log.warn(`handoff message failed for continuation ${state.operationId}: ${String(error)}`);
	}
	try {
		recordChatContinuation(state.sourceWorkspaceId, {
			projectId: project.id,
			workspaceId: workspace.id,
			sessionId: targetSessionId,
		});
	} catch (error) {
		log.warn(`continuation link not recorded for ${state.sourceWorkspaceId}: ${String(error)}`);
	}
	emit(operation, { phase: "started", firstMessage });
	return `Continued in workspace "${workspace.name}" of ${project.name} (workspace ${workspace.id}, chat ${targetSessionId}); the handoff ${firstMessage === "sent" ? "was delivered" : "could not be delivered — the user can resend it"}.`;
}

/** A source turn that settles without the tool call ends the operation: the user sees "No summary" and may retry. */
export function observeContinuation(sessionId: string, event: PiEvent): void {
	if (event.type !== "agent_settled") return;
	const operationId = bySource.get(sessionId);
	const operation = operationId ? operations.get(operationId) : undefined;
	if (operation?.state.phase !== "summarizing") return;
	emit(operation, { phase: "failed", reason: "The agent finished without a summary." });
}

export const continueToolHost: ContinueToolHost = {
	apply: (sessionId, summary) => applyContinuation(sessionId, summary),
};

export function resetContinuationsForTests(): void {
	operations.clear();
	bySource.clear();
}
