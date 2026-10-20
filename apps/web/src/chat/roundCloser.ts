import type { ChatTurn } from "./types";

function isUnansweredResult(turn: ChatTurn | undefined): boolean {
	if (turn?.kind === "backgroundCommandCompletion") return turn.details.status === "stopped";
	if (turn?.kind === "subagentCompletion") return turn.details.abortReason === "user";
	return false;
}

export function insertRoundCloser(turns: readonly ChatTurn[], closer: ChatTurn): ChatTurn[] {
	let at = turns.length;
	while (at > 0 && isUnansweredResult(turns[at - 1])) at--;
	return [...turns.slice(0, at), closer, ...turns.slice(at)];
}
