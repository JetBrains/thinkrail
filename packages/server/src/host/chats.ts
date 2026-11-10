import { existsSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import type { ChatCreateResult, ChatInspection, Workspace } from "@thinkrail/contracts";
import { CHATS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import {
	type CreateSessionResult,
	closeWorkspaceSessions,
	createSession,
	deleteSession,
	listSessions,
	trashWorkspaceDelegation,
} from "../agent";
import { forgetWorkspaceChanges } from "../changes";
import { logger } from "../log";
import { removeWorkspaceReviews } from "../reviews";
import { evictSpecIndex } from "../spec";
import { closeWorkspaceTerminals } from "../terminal";
import { trashFile } from "../trash";
import { forgetWorkspaceTurns } from "../turns";
import { stopWatch } from "../watch";
import {
	chatWorkspaces,
	createChatRecord,
	dropChatRecord,
	ensureWorkspaceScratchDir,
	getChatWorkspace,
	isChatWorkspaceId,
	isUnderChatsRoot,
	markChatDeletionPending,
} from "../workspaces";
import { provisionInitialTerminal } from "./initialTerminal";
import { type NewChatModelRequest, noteNewChat, resolveNewChatModel } from "./newChatModel";
import { runObservation } from "./runAnalytics";
import { taskObservation } from "./taskAnalytics";

const log = logger("host");

/** Entries visited (files and folders alike) and wall time one inspection may spend before it answers `truncated`. */
export const CHAT_INSPECT_BUDGET = { entries: 10_000, ms: 250 } as const;

/** The one visibility policy: a client below `CHATS_PROTOCOL_VERSION` never learns of the Chats container, its chats or their sessions. */
export function seesChats(protocolVersion: number | undefined): boolean {
	return protocolVersion === undefined || protocolVersion >= CHATS_PROTOCOL_VERSION;
}

/** The transcripts no history read may show: a chat's whose deletion did not finish, and every chat's to an older client. */
export function historyHiddenCwd(protocolVersion: number | undefined): (cwd: string) => boolean {
	const pending = new Set(
		chatWorkspaces()
			.filter((chat) => chat.deletionPending === true)
			.map((chat) => chat.worktreePath),
	);
	const everyChat = !seesChats(protocolVersion);
	return (cwd) => pending.has(cwd) || (everyChat && isUnderChatsRoot(cwd));
}

type ChatClaim =
	| { kind: "start"; done: Promise<ChatCreateResult> }
	| { kind: "delete"; done: Promise<void> };

/** One lifecycle claim per chat: its first session (create or recovery) and its deletion never overlap. */
const claims = new Map<string, ChatClaim>();

function beingDeleted(): CodedError {
	return new CodedError("CHAT_DELETING", "This chat is being deleted.");
}

/** A chat being deleted, or whose deletion did not finish, starts nothing: no session, attach or terminal. */
export function assertChatOpen(workspaceId: string): void {
	if (!isChatWorkspaceId(workspaceId)) return;
	if (claims.get(workspaceId)?.kind === "delete") throw beingDeleted();
	if (getChatWorkspace(workspaceId).deletionPending) {
		throw new CodedError("CHAT_DELETION_PENDING", "This chat's deletion did not finish; retry it.");
	}
}

/** The chat's folder, record and the one session that owns it, in one operation. */
export function createChat(requested: NewChatModelRequest = {}): Promise<ChatCreateResult> {
	return claimStart(provisionInitialTerminal(createChatRecord()), requested, false);
}

/** A chat whose session never came up (crash between folder and session) gets it here; a start in flight is joined. */
export function recoverChatSession(
	workspaceId: string,
	requested: NewChatModelRequest = {},
): Promise<ChatCreateResult> {
	const claim = claims.get(workspaceId);
	if (claim?.kind === "start") return claim.done;
	assertChatOpen(workspaceId);
	return claimStart(getChatWorkspace(workspaceId), requested, true);
}

function claimStart(
	workspace: Workspace,
	requested: NewChatModelRequest,
	recovering: boolean,
): Promise<ChatCreateResult> {
	const claim: ChatClaim = {
		kind: "start",
		done: Promise.resolve()
			.then(async () => {
				if (recovering && (await listSessions(workspace.id, workspace.worktreePath)).length > 0) {
					throw new CodedError(
						"CHAT_HAS_SESSION",
						"A chat without a project holds one conversation; start a new chat instead.",
					);
				}
				return startChatSession(workspace, requested, () => claims.get(workspace.id) === claim);
			})
			.finally(() => {
				if (claims.get(workspace.id) === claim) claims.delete(workspace.id);
			}),
	};
	claims.set(workspace.id, claim);
	return claim.done;
}

async function startChatSession(
	workspace: Workspace,
	requested: NewChatModelRequest,
	claimed: () => boolean,
): Promise<ChatCreateResult> {
	const defaults = await resolveNewChatModel(requested);
	if (!claimed()) throw beingDeleted();
	ensureWorkspaceScratchDir(workspace);
	let created: CreateSessionResult;
	try {
		created = await createSession({
			cwd: workspace.worktreePath,
			workspaceId: workspace.id,
			...(defaults.model ? { model: defaults.model } : {}),
			thinkingLevel: defaults.thinkingLevel,
		});
	} catch (error) {
		throw claimed() ? error : beingDeleted();
	}
	if (!claimed()) throw beingDeleted();
	noteNewChat(requested, defaults, created);
	return { workspace, ...created };
}

export function assertSessionDeletable(workspaceId: string): void {
	if (isChatWorkspaceId(workspaceId)) {
		throw new CodedError(
			"CHAT_WORKSPACE",
			"A chat without a project is deleted as a whole: delete the chat.",
		);
	}
}

/** How many files the chat's folder holds: an asynchronous walk within the budget, symlinks never followed. */
export async function inspectChat(
	workspaceId: string,
	budget: { entries: number; ms: number } = CHAT_INSPECT_BUDGET,
	now: () => number = () => performance.now(),
): Promise<ChatInspection> {
	const root = getChatWorkspace(workspaceId).worktreePath;
	const scaffold = join(root, WORKSPACE_CONTEXT_DIR, ".gitignore");
	const deadline = now() + budget.ms;
	let files = 0;
	let entries = 0;
	const queue = [root];
	for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
		if (now() > deadline) return { files, truncated: true };
		try {
			for await (const entry of await opendir(dir)) {
				entries += 1;
				if (entries > budget.entries || now() > deadline) return { files, truncated: true };
				const path = join(dir, entry.name);
				if (entry.isDirectory()) queue.push(path);
				else if (path !== scaffold) files += 1;
			}
		} catch {}
	}
	return { files, truncated: false };
}

/** The only teardown door for a chat; concurrent calls join, a failure leaves the pending record for Retry. */
export function deleteChat(workspaceId: string): Promise<void> {
	const current = claims.get(workspaceId);
	if (current?.kind === "delete") return current.done;
	const workspace = markChatDeletionPending(workspaceId);
	const claim: ChatClaim = {
		kind: "delete",
		done: Promise.resolve()
			.then(() => runChatDeletion(workspace))
			.finally(() => {
				if (claims.get(workspaceId) === claim) claims.delete(workspaceId);
			}),
	};
	claims.set(workspaceId, claim);
	return claim.done;
}

async function runChatDeletion(workspace: Workspace): Promise<void> {
	const { id, worktreePath: cwd } = workspace;
	await closeWorkspaceSessions(id, async () => {
		for (const summary of await listSessions(id, cwd)) {
			runObservation.forget(summary.sessionId);
			taskObservation.forget(summary.sessionId);
			await deleteSession(summary.sessionId, id, cwd);
		}
		await trashWorkspaceDelegation(id);
	});
	closeWorkspaceTerminals(id);
	stopWatch(id);
	evictSpecIndex(id);
	removeWorkspaceReviews(id);
	forgetWorkspaceChanges(id);
	forgetWorkspaceTurns(id);
	if (isUnderChatsRoot(cwd) && existsSync(cwd)) await trashFile(cwd);
	dropChatRecord(id);
	log.info(`deleted chat ${id}`);
}
