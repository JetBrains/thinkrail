import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ChatCreateResult, ChatInspection, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { createSession, deleteSession, getSessionWorkspaceId, listSessions } from "../agent";
import { forgetWorkspaceChanges } from "../changes";
import { logger } from "../log";
import { removeWorkspaceReviews } from "../reviews";
import { evictSpecIndex } from "../spec";
import { closeWorkspaceTerminals } from "../terminal";
import { trashFile } from "../trash";
import { forgetWorkspaceTurns } from "../turns";
import { stopWatch } from "../watch";
import {
	createChatRecord,
	dropChatRecord,
	ensureWorkspaceScratchDir,
	getChatWorkspace,
	isChatWorkspaceId,
	markChatDeletionPending,
} from "../workspaces";
import { trackChatStarted } from "./authAnalytics";
import { provisionInitialTerminal } from "./initialTerminal";
import { type NewChatModelRequest, resolveNewChatModel } from "./newChatModel";
import { runObservation } from "./runAnalytics";
import { taskObservation } from "./taskAnalytics";

const log = logger("host");

export const CHAT_INSPECT_FILE_LIMIT = 10_000;

const deleting = new Map<string, Promise<void>>();

function assertNotDeleting(workspaceId: string): void {
	if (deleting.has(workspaceId)) {
		throw new CodedError("CHAT_WORKSPACE", "This chat is being deleted.");
	}
}

/** The chat's folder, record and the one session that owns it, in one operation. */
export async function createChat(requested: NewChatModelRequest = {}): Promise<ChatCreateResult> {
	return startChatSession(provisionInitialTerminal(createChatRecord()), requested);
}

/** A chat whose session never came up (crash between folder and session) gets its session here; idempotent. */
export async function ensureChatSession(workspaceId: string): Promise<ChatCreateResult> {
	const workspace = getChatWorkspace(workspaceId);
	assertNotDeleting(workspaceId);
	if (workspace.deletionPending) {
		throw new CodedError("CHAT_WORKSPACE", "This chat's deletion did not finish; retry it.");
	}
	const existing = (await listSessions(workspace.id, workspace.worktreePath))[0];
	if (existing) {
		return {
			workspace,
			sessionId: existing.sessionId,
			model: null,
			thinkingLevel: "medium",
		};
	}
	return startChatSession(workspace);
}

async function startChatSession(
	workspace: Workspace,
	requested: NewChatModelRequest = {},
): Promise<ChatCreateResult> {
	ensureWorkspaceScratchDir(workspace);
	const defaults = await resolveNewChatModel(requested);
	const created = await createSession({
		cwd: workspace.worktreePath,
		workspaceId: workspace.id,
		...(defaults.model ? { model: defaults.model } : {}),
		thinkingLevel: defaults.thinkingLevel,
	});
	trackChatStarted({ sessionId: created.sessionId, model: created.model });
	return { workspace, ...created };
}

/** A chat owns exactly one top-level session; a second one is refused — a new chat is a new folder. */
export async function assertChatAcceptsSession(workspaceId: string): Promise<void> {
	if (!isChatWorkspaceId(workspaceId)) return;
	assertNotDeleting(workspaceId);
	const workspace = getChatWorkspace(workspaceId);
	if ((await listSessions(workspace.id, workspace.worktreePath)).length > 0) {
		throw new CodedError(
			"CHAT_WORKSPACE",
			"A chat without a project holds one conversation; start a new chat instead.",
		);
	}
}

export function assertSessionDeletable(workspaceId: string): void {
	if (isChatWorkspaceId(workspaceId)) {
		throw new CodedError(
			"CHAT_WORKSPACE",
			"A chat without a project is deleted as a whole: delete the chat.",
		);
	}
}

/** How many files the chat's folder holds, bounded and without following symlinks. */
export function inspectChat(workspaceId: string): ChatInspection {
	const workspace = getChatWorkspace(workspaceId);
	let files = 0;
	const queue = [workspace.worktreePath];
	for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of entries) {
			const path = join(dir, name);
			const entry = lstatSync(path, { throwIfNoEntry: false });
			if (!entry) continue;
			if (entry.isDirectory()) queue.push(path);
			else {
				files += 1;
				if (files >= CHAT_INSPECT_FILE_LIMIT) return { files, truncated: true };
			}
		}
	}
	return { files, truncated: false };
}

/**
 * The only teardown door for a chat: claim it, mark the record, dispose every session (their transcripts go
 * to the trash file by file), stop what runs in the folder, trash the folder, drop the record.
 */
export function deleteChat(workspaceId: string): Promise<void> {
	const inFlight = deleting.get(workspaceId);
	if (inFlight) return inFlight;
	const done = runChatDeletion(workspaceId).finally(() => deleting.delete(workspaceId));
	deleting.set(workspaceId, done);
	return done;
}

async function runChatDeletion(workspaceId: string): Promise<void> {
	const workspace = markChatDeletionPending(workspaceId);
	const cwd = workspace.worktreePath;
	for (const summary of await listSessions(workspace.id, cwd)) {
		if (getSessionWorkspaceId(summary.sessionId) !== undefined) {
			runObservation.forget(summary.sessionId);
			taskObservation.forget(summary.sessionId);
		}
		await deleteSession(summary.sessionId, workspace.id, cwd);
	}
	closeWorkspaceTerminals(workspace.id);
	stopWatch(workspace.id);
	evictSpecIndex(workspace.id);
	removeWorkspaceReviews(workspace.id);
	forgetWorkspaceChanges(workspace.id);
	forgetWorkspaceTurns(workspace.id);
	if (existsSync(cwd)) await trashFile(cwd);
	dropChatRecord(workspace.id);
	log.info(`deleted chat ${workspace.id}`);
}
