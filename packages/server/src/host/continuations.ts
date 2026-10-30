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
	chatWorkspaces,
	createWorkspace,
	ensureWorkspaceScratchDir,
	getChatWorkspace,
	getWorkspace,
	isChatsContainer,
	recordChatContinuation,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { assertChatOpen } from "./chats";
import { provisionInitialTerminal } from "./initialTerminal";
import { noteNewChat, resolveNewChatModel } from "./newChatModel";

const log = logger("host");

/** How long `chat.continue` waits for the request to be refused before answering: a turn runs much longer. */
const REQUEST_ACK_MS = 1_500;

type Publisher = (continuation: ChatContinuation) => void;

interface Operation {
	state: ChatContinuation;
	project: Project;
	sourceTitle?: string;
	/** The operation's one apply: every later tool call joins it (pi runs one response's calls in parallel). */
	applying?: Promise<string>;
}

const operations = new Map<string, Operation>();
const bySource = new Map<string, string>();
/** A gesture still being admitted, per source chat: a concurrent gesture for its project joins it instead of racing it. */
const admissions = new Map<string, { projectId: string; done: Promise<{ operationId: string }> }>();
let publish: Publisher | null = null;

export function setContinuationPublisher(next: Publisher | null): void {
	publish = next;
}

function emit(operation: Operation, patch: Partial<ChatContinuation>): ChatContinuation {
	operation.state = { ...operation.state, ...patch };
	publish?.(operation.state);
	return operation.state;
}

function fail(operation: Operation, error: unknown): void {
	emit(operation, { phase: "failed", reason: String(error) });
}

function boundTo(sessionId: string): Operation | undefined {
	const operationId = bySource.get(sessionId);
	return operationId ? operations.get(operationId) : undefined;
}

function inFlight({ state }: Operation): boolean {
	return state.phase === "requested" || state.phase === "summarizing" || state.phase === "creating";
}

/** A second gesture for another project is refused rather than silently following the first. */
function continuingElsewhere(projectId: string): CodedError {
	const name =
		listProjects().find((project) => project.id === projectId)?.name ?? "another project";
	return new CodedError(
		"CONTINUATION_IN_FLIGHT",
		`This chat is already being continued in ${name}.`,
	);
}

function openRepository(projectId: string): Project | null {
	const project = listProjects().find((candidate) => candidate.id === projectId);
	return project && !isChatsContainer(project) ? project : null;
}

function projectWorkspace(workspaceId: string, projectId: string): Workspace | null {
	try {
		const workspace = getWorkspace(workspaceId);
		return workspace.projectId === projectId ? workspace : null;
	} catch {
		return null;
	}
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

/**
 * Binds one operation to the source chat and asks its agent for the summary; a busy chat queues the request.
 * A gesture for the same project while the chat's operation is still in flight, or still being admitted,
 * joins it; one for another project is refused.
 */
export function startContinuation(
	sourceWorkspaceId: string,
	projectId: string,
): Promise<{ operationId: string }> {
	const admitting = admissions.get(sourceWorkspaceId);
	if (admitting) {
		return admitting.projectId === projectId
			? admitting.done
			: Promise.reject(continuingElsewhere(admitting.projectId));
	}
	const done = admitContinuation(sourceWorkspaceId, projectId).finally(() => {
		if (admissions.get(sourceWorkspaceId)?.done === done) admissions.delete(sourceWorkspaceId);
	});
	admissions.set(sourceWorkspaceId, { projectId, done });
	return done;
}

async function admitContinuation(
	sourceWorkspaceId: string,
	projectId: string,
): Promise<{ operationId: string }> {
	const source = getChatWorkspace(sourceWorkspaceId);
	assertChatOpen(source.id);
	const project = openRepository(projectId);
	if (!project) throw new CodedError("CHATS_CONTAINER", "Pick an open project to continue in.");
	const summary = (await listSessions(source.id, source.worktreePath))[0];
	assertChatOpen(source.id);
	if (!summary || summary.messageCount === 0) {
		throw new CodedError("NOT_A_CHAT", "This chat has no conversation to continue.");
	}
	const sourceSessionId = summary.sessionId;
	const previous = boundTo(sourceSessionId);
	if (previous && inFlight(previous)) {
		if (previous.state.projectId !== project.id)
			throw continuingElsewhere(previous.state.projectId);
		return { operationId: previous.state.operationId };
	}
	if (
		getSessionWorkspaceId(sourceSessionId) === undefined &&
		!(await ensureSessionAttached(sourceSessionId, source.id, source.worktreePath))
	) {
		throw new CodedError("NOT_A_CHAT", "This chat's conversation could not be opened.");
	}
	assertChatOpen(source.id);
	const leftover =
		previous?.state.phase === "failed" &&
		previous.state.projectId === project.id &&
		previous.state.workspaceId
			? projectWorkspace(previous.state.workspaceId, project.id)
			: null;
	const operation: Operation = {
		state: {
			operationId: randomUUID(),
			sourceWorkspaceId: source.id,
			sourceSessionId,
			projectId: project.id,
			phase: "requested",
			...(leftover ? { workspaceId: leftover.id } : {}),
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
			REQUEST_ACK_MS,
		);
	} catch (error) {
		fail(operation, error);
		throw error;
	}
	return { operationId: operation.state.operationId };
}

/** The host's phases while it holds the operation; after a restart a linked one reads `started` from its link. */
export async function continuationStatus(operationId: string): Promise<ChatContinuation> {
	const operation = operations.get(operationId);
	if (operation) return operation.state;
	for (const chat of chatWorkspaces()) {
		const link = chat.continuedTo?.find((candidate) => candidate.operationId === operationId);
		if (!link) continue;
		const source = (await listSessions(chat.id, chat.worktreePath))[0];
		return {
			operationId,
			sourceWorkspaceId: chat.id,
			sourceSessionId: source?.sessionId ?? "",
			projectId: link.projectId,
			workspaceId: link.workspaceId,
			sessionId: link.sessionId,
			phase: "started",
		};
	}
	throw new CodedError("CONTINUATION_UNKNOWN", "The host no longer knows this continuation.");
}

/** The tool's host side: one apply per operation, joined by every later call for it. */
export function applyContinuation(sessionId: string, summary: string): Promise<string> {
	const operation = boundTo(sessionId);
	const phase = operation?.state.phase;
	if (!operation || (phase !== "summarizing" && phase !== "creating" && phase !== "started")) {
		return Promise.reject(
			new Error(
				"No continuation is pending for this chat. ThinkRail asks for one with a card in the chat; if the host restarted since, the user has to ask again.",
			),
		);
	}
	operation.applying ??= runContinuation(operation, summary);
	return operation.applying;
}

/** Revalidate, create the workspace and its chat (or reuse what a failed attempt left), hand over, link. */
async function runContinuation(operation: Operation, summary: string): Promise<string> {
	const { operationId, projectId, sourceWorkspaceId, sourceSessionId } = operation.state;
	const project = openRepository(projectId);
	if (!project) {
		emit(operation, { phase: "failed", reason: "The project is no longer open." });
		throw new Error("The project to continue in is no longer open.");
	}
	emit(operation, { phase: "creating" });
	const leftover = operation.state.workspaceId
		? projectWorkspace(operation.state.workspaceId, project.id)
		: null;
	let workspace: Workspace;
	try {
		workspace = leftover ?? provisionInitialTerminal(await createWorkspace(project.id));
	} catch (error) {
		fail(operation, error);
		throw error;
	}
	emit(operation, { workspaceId: workspace.id });
	let targetSessionId: string;
	try {
		ensureWorkspaceScratchDir(workspace);
		const defaults = await resolveNewChatModel({});
		const created = await createSession({
			cwd: workspace.worktreePath,
			workspaceId: workspace.id,
			...(defaults.model ? { model: defaults.model } : {}),
			thinkingLevel: defaults.thinkingLevel,
		});
		noteNewChat({}, defaults, created);
		targetSessionId = created.sessionId;
	} catch (error) {
		fail(operation, error);
		throw error;
	}
	emit(operation, { sessionId: targetSessionId });
	const details: ChatHandoffDetails = {
		operationId,
		sourceWorkspaceId,
		sourceSessionId,
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
		log.warn(`handoff message failed for continuation ${operationId}`, error);
	}
	try {
		recordChatContinuation(sourceWorkspaceId, {
			operationId,
			projectId: project.id,
			workspaceId: workspace.id,
			sessionId: targetSessionId,
		});
	} catch (error) {
		log.warn(`continuation link not recorded for ${sourceWorkspaceId}`, error);
	}
	emit(operation, { phase: "started", firstMessage });
	return `Continued in workspace "${workspace.name}" of ${project.name} (workspace ${workspace.id}, chat ${targetSessionId}); the handoff ${firstMessage === "sent" ? "was delivered" : "could not be delivered"}.`;
}

/** A source turn that settles without the tool call ends the operation: the user sees "No summary" and may retry. */
export function observeContinuation(sessionId: string, event: PiEvent): void {
	if (event.type !== "agent_settled") return;
	const operation = boundTo(sessionId);
	if (operation?.state.phase !== "summarizing") return;
	emit(operation, { phase: "failed", reason: "The agent finished without a summary." });
}

export const continueToolHost: ContinueToolHost = {
	apply: (sessionId, summary) => applyContinuation(sessionId, summary),
};

export function resetContinuationsForTests(): void {
	operations.clear();
	bySource.clear();
	admissions.clear();
}
