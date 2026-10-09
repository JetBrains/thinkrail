import {
	type AskUserQuestionResult,
	assistantToolCallsAreExecutable,
	type StopReason,
} from "@thinkrail/contracts";

export interface AskState {
	answer?: AskUserQuestionResult;
	superseded: boolean;
	terminal: boolean;
}

// Structural inputs expressed from `contracts` only: `lib` is a leaf and must not import `chat`'s
// `ChatTurn`/`ToolResultState`. A caller's richer turn/result types are assignable to these.
interface AskToolCallBlock {
	type: string;
	name?: string;
	id?: string;
}
interface AskAssistantTurn {
	kind: "assistant";
	message: { content: readonly AskToolCallBlock[]; stopReason: StopReason };
}
interface AskToolResult {
	status?: string;
	raw?: unknown;
}

function isAssistantTurn(turn: { kind: string }): turn is AskAssistantTurn {
	return turn.kind === "assistant";
}

export function readAskResult(raw: unknown): AskUserQuestionResult | null {
	const isResult = (value: unknown): value is AskUserQuestionResult =>
		!!value &&
		typeof value === "object" &&
		Array.isArray((value as AskUserQuestionResult).answers) &&
		typeof (value as AskUserQuestionResult).cancelled === "boolean";
	if (raw && typeof raw === "object" && isResult((raw as { details?: unknown }).details)) {
		return (raw as { details: AskUserQuestionResult }).details;
	}
	return isResult(raw) ? raw : null;
}

function isAckResult(raw: unknown): boolean {
	return (
		!!raw &&
		typeof raw === "object" &&
		Reflect.get(Reflect.get(raw, "details") ?? {}, "kind") === "ack"
	);
}

export function deriveAskStates(
	turns: readonly { kind: string }[],
	askAnswers: Record<string, AskUserQuestionResult>,
	toolResults: Record<string, AskToolResult> = {},
): Record<string, AskState> {
	const calls: Record<string, { turnIndex: number; dead: boolean }> = {};
	let lastUserIndex = -1;
	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "user") {
			lastUserIndex = i;
		} else if (isAssistantTurn(turn)) {
			for (const block of turn.message.content) {
				if (block.type === "toolCall" && block.name === "ask_user_question" && block.id) {
					calls[block.id] = {
						turnIndex: i,
						dead: !assistantToolCallsAreExecutable(turn.message.stopReason),
					};
				}
			}
		}
	}
	const states: Record<string, AskState> = {};
	for (const [toolCallId, call] of Object.entries(calls)) {
		const tool = toolResults[toolCallId];
		const answer = askAnswers[toolCallId] ?? readAskResult(tool?.raw) ?? undefined;
		const terminal =
			call.dead ||
			tool?.status === "error" ||
			(tool?.status === "done" && answer === undefined && !isAckResult(tool.raw));
		states[toolCallId] = {
			...(answer ? { answer } : {}),
			superseded: !answer && !terminal && lastUserIndex > call.turnIndex,
			terminal,
		};
	}
	return states;
}
