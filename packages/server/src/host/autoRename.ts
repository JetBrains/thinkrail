import type { PiEvent, TranscriptMessage, Workspace } from "@thinkrail/contracts";
import { getSessionMessages } from "../agent";
import { extractFirstTurn, naiveWorkspaceName, suggestWorkspaceName } from "../assist";
import { logger } from "../log";
import { getWorkspace, renameWorkspace } from "../workspaces";

const log = logger("host");

const PRISTINE_BRANCH = /^workspace-\d+$/;

export function isSettledTurn(event: PiEvent): boolean {
	return event.type === "agent_settled";
}

export function isPromptCommitted(event: PiEvent): boolean {
	return event.type === "message_end" && event.message.role === "user";
}

const inFlight = new Set<string>();

const naiveInFlight = new Set<string>();

export type TranscriptReader = () => Promise<TranscriptMessage[]>;

export async function maybeNaiveNameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript?: TranscriptReader,
): Promise<Workspace | null> {
	if (naiveInFlight.has(workspaceId)) return null;
	if (!isPristine(workspaceId)) return null;

	naiveInFlight.add(workspaceId);
	try {
		const read =
			readTranscript ??
			(async () =>
				(await getSessionMessages(sessionId, workspaceId, getWorkspace(workspaceId).worktreePath))
					.messages);
		const turn = extractFirstTurn(await read());
		if (!turn) return null;
		const name = naiveWorkspaceName(turn.prompt);
		if (!name) return null;

		if (!isPristine(workspaceId)) return null;
		return renameWorkspace(workspaceId, name, { lock: false });
	} catch {
		log.warn(`workspace naive-rename skipped (${workspaceId})`);
		return null;
	} finally {
		naiveInFlight.delete(workspaceId);
	}
}

function isPristine(workspaceId: string): boolean {
	try {
		const ws = getWorkspace(workspaceId);
		return !ws.renamed && PRISTINE_BRANCH.test(ws.branch);
	} catch {
		return false;
	}
}

export async function maybeAutoRenameWorkspace(
	sessionId: string,
	workspaceId: string,
	readTranscript?: TranscriptReader,
): Promise<Workspace | null> {
	if (inFlight.has(workspaceId)) return null;
	let ws: Workspace;
	try {
		ws = getWorkspace(workspaceId);
	} catch {
		return null;
	}
	if (ws.renamed) return null;

	inFlight.add(workspaceId);
	try {
		const read =
			readTranscript ??
			(async () => (await getSessionMessages(sessionId, workspaceId, ws.worktreePath)).messages);
		const messages = await read();

		const turn = extractFirstTurn(messages);
		if (!turn) return null;
		const name = await suggestWorkspaceName(turn);
		if (!name) return null;

		const fresh = getWorkspace(workspaceId);
		if (fresh.renamed) return null;
		return renameWorkspace(workspaceId, name);
	} catch {
		log.warn(`workspace auto-rename skipped (${workspaceId})`);
		return null;
	} finally {
		inFlight.delete(workspaceId);
	}
}
