// Session lifecycle — the only lifecycle surface the harness exposes over the server agent barrel.
// Uses the PRODUCTION wiring (`createSession`: extension paths, skills dirs, the real ask_user_question
// tool, settings), so scenarios test what ships. Model = the pinned default from the isolated
// settings.json; never setModel (an @agent test must not persist a default mid-run).
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
	/** `provider/id` of the model the session resolved to — run-log attribution. */
	model: string;
}

let counter = 0;

/** Create a real in-process agent session rooted in `cwd` (production resource loader + skills). */
export async function startSession(cwd: string): Promise<StartedSession> {
	const result = await createSession({ cwd, workspaceId: `workflow-test-${++counter}` });
	const model = result.model ? `${result.model.provider}/${result.model.id}` : "unknown";
	return { sessionId: result.sessionId, model };
}

/**
 * Send one user turn and wait for it to settle. An abort (a stop-signal/budget fired mid-turn) is an
 * EXPECTED outcome, not a failure — the turn resolves normally and the caller reads the outcome off the
 * event log. But "looks like an abort" alone is not enough: network stacks say "aborted" for timeouts
 * nothing requested, so the error is swallowed ONLY when `expectedAbort()` confirms the harness actually
 * asked for one. Everything else — provider/auth/network failures — rethrows as the crash it is.
 */
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

/** Abort a streaming turn (used by stop-signals/watchdog). Safe to call on an idle session. */
export async function stopTurn(sessionId: string): Promise<void> {
	try {
		await abortSession(sessionId);
	} catch {
		// Already settled/removed — nothing to stop.
	}
}

/** Tear one session down (scenario `finally`). */
export function endSession(sessionId: string): void {
	removeSession(sessionId);
}

/** Suite-level safety net. */
export function endAllSessions(): void {
	disposeAllSessions();
}
