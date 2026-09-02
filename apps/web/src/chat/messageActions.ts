import type { ChatRow } from "./rows";

export interface MessageActionState {
	agentRespondedByUserId: ReadonlyMap<string, boolean>;
	finalAnswerRowIds: ReadonlySet<string>;
}

export function deriveMessageActions(
	chronologicalRows: readonly ChatRow[],
	isStreaming: boolean,
): MessageActionState {
	const agentRespondedByUserId = new Map<string, boolean>();
	const finalAnswerRowIds = new Set<string>();
	let sawRespondingRow = false;
	let sawLaterUser = false;
	let roundHasLaterContent = false;

	for (let index = chronologicalRows.length - 1; index >= 0; index -= 1) {
		const row = chronologicalRows[index];
		if (!row) continue;

		switch (row.kind) {
			case "user":
				agentRespondedByUserId.set(row.id, sawRespondingRow || (!sawLaterUser && isStreaming));
				sawLaterUser = true;
				roundHasLaterContent = false;
				break;
			case "markdown":
				sawRespondingRow = true;
				if (!roundHasLaterContent) finalAnswerRowIds.add(row.id);
				roundHasLaterContent = true;
				break;
			case "tool":
			case "activity":
				sawRespondingRow = true;
				roundHasLaterContent = true;
				break;
			case "divider":
				sawRespondingRow = true;
				break;
		}
	}

	return { agentRespondedByUserId, finalAnswerRowIds };
}
