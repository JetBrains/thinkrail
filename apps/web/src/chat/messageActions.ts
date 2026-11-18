import { completionDelivery } from "@thinkrail/contracts";
import type { ChatRow } from "./rows";
import { carriesComposerSuggestions } from "./toolRegistry";

export interface MessageActionState {
	agentRespondedByUserId: ReadonlyMap<string, boolean>;
	finalAnswerRowIds: ReadonlySet<string>;
}

function suggestionsOnly(row: Extract<ChatRow, { kind: "tool" | "activity" }>): boolean {
	if (row.kind === "tool") return carriesComposerSuggestions(row.toolName);
	return (
		row.steps.length > 0 &&
		row.steps.every((step) => step.kind === "tool" && carriesComposerSuggestions(step.toolName))
	);
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
				if (!suggestionsOnly(row)) roundHasLaterContent = true;
				break;
			case "divider":
				sawRespondingRow = true;
				break;
			case "backgroundCommandCompletion":
			case "subagentCompletion":
				if (completionDelivery(row.details) !== "run") roundHasLaterContent = false;
				break;
			case "reviewFix":
			case "continuationRequest":
			case "handoff":
				roundHasLaterContent = false;
				break;
		}
	}

	return { agentRespondedByUserId, finalAnswerRowIds };
}
