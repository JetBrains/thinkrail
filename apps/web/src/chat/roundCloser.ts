import { completionDelivery } from "@thinkrail/contracts";
import type { ChatTurn } from "./types";

function isUnansweredResult(turn: ChatTurn | undefined): boolean {
	if (turn?.kind !== "backgroundCommandCompletion" && turn?.kind !== "subagentCompletion")
		return false;
	const delivery = completionDelivery(turn.details);
	if (delivery !== undefined) return delivery === "appended";
	return turn.kind === "backgroundCommandCompletion"
		? turn.details.status === "stopped"
		: turn.details.abortReason === "user";
}

export function insertRoundCloser(turns: readonly ChatTurn[], closer: ChatTurn): ChatTurn[] {
	let at = turns.length;
	while (at > 0 && isUnansweredResult(turns[at - 1])) at--;
	return [...turns.slice(0, at), closer, ...turns.slice(at)];
}
