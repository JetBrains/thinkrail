import "./env";
import {
	abortSession,
	createSession,
	disposeAllSessions,
	promptSession,
	removeSession,
} from "@thinkrail/server/agent";

export interface StartedSession {
	sessionId: string;
	model: string;
}

let counter = 0;

export async function startSession(cwd: string): Promise<StartedSession> {
	const result = await createSession({ cwd, workspaceId: `workflow-test-${++counter}` });
	const model = result.model ? `${result.model.provider}/${result.model.id}` : "unknown";
	return { sessionId: result.sessionId, model };
}

export async function promptTurn(
	sessionId: string,
	text: string,
	expectedAbort: () => boolean = () => false,
): Promise<void> {
	try {
		await promptSession(sessionId, text);
	} catch (error) {
		if (isAbortError(error) && expectedAbort()) return;
		throw error;
	}
}

function isAbortError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /abort/i.test(message);
}

export async function stopTurn(sessionId: string): Promise<void> {
	try {
		await abortSession(sessionId);
	} catch {}
}

export function endSession(sessionId: string): void {
	removeSession(sessionId);
}

export function endAllSessions(): void {
	disposeAllSessions();
}
