import type { ChatLocationRequest } from "@/store";
import { turnAnchorText } from "./recentPrompts";
import { type ChatRow, rowIndexForToolCall, rowIndexForTurn } from "./rows";
import type { ChatTurn } from "./types";

export interface LocatedRow {
	index: number;
	/** The row is the nearest shown ancestor of what the request named, not the target itself. */
	nearest: boolean;
}

function firstToolCallRow(
	turn: ChatTurn & { kind: "assistant" },
	rows: readonly ChatRow[],
): number {
	for (const block of turn.message.content) {
		if (block.type !== "toolCall") continue;
		const index = rowIndexForToolCall(rows, block.id);
		if (index !== -1) return index;
	}
	return -1;
}

/**
 * The row a jump lands on: the tool call's row when the request names one the chat shows, else the
 * message's row (by display index, then by non-empty anchor text) — for an assistant message with no text
 * row, its first tool call's — flagged `nearest` when it stands in for a tool call, a text-less message
 * or an entry the chat does not show.
 */
export function locateChatRow(
	request: Pick<ChatLocationRequest, "messageIndex" | "anchorText" | "toolCallId" | "approximate">,
	rows: readonly ChatRow[],
	turns: readonly ChatTurn[],
	turnIdByMessageIndex: readonly (string | null)[] | undefined,
): LocatedRow {
	const { messageIndex, anchorText, toolCallId } = request;
	const toolIndex = toolCallId ? rowIndexForToolCall(rows, toolCallId) : -1;
	const nearest = request.approximate === true || (toolCallId !== undefined && toolIndex === -1);
	if (toolIndex !== -1) return { index: toolIndex, nearest };
	const prefix = anchorText.slice(0, 40);
	const searchable = prefix.trim() !== "";
	const mappedId = turnIdByMessageIndex?.[messageIndex];
	const mapped = mappedId ? turns.find((turn) => turn.id === mappedId) : undefined;
	const target =
		mapped && (!searchable || turnAnchorText(mapped).includes(prefix))
			? mapped
			: searchable
				? turns.findLast((turn) => turnAnchorText(turn).includes(prefix))
				: undefined;
	if (!target) return { index: -1, nearest };
	const index = rowIndexForTurn([...rows], target.id);
	if (index !== -1 || target.kind !== "assistant") return { index, nearest };
	return { index: firstToolCallRow(target, rows), nearest: true };
}
