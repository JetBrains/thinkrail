import { isInteractiveTool, readComposerSuggestions } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

export interface ComposerSuggestionsSource {
	turns: readonly ChatTurn[];
	toolResults: Readonly<Record<string, ToolResultState>>;
	isStreaming: boolean;
	queue: { steering: readonly unknown[]; followUp: readonly unknown[] };
}

const NONE: readonly string[] = [];

export function deriveComposerSuggestions(
	source: ComposerSuggestionsSource | undefined,
	disabledExtensions: readonly string[] = [],
): readonly string[] {
	if (!source || source.isStreaming) return NONE;
	if (source.queue.steering.length > 0 || source.queue.followUp.length > 0) return NONE;
	let last: ChatTurn | undefined;
	for (let i = source.turns.length - 1; i >= 0; i--) {
		const turn = source.turns[i];
		if (turn && turn.kind !== "system") {
			last = turn;
			break;
		}
	}
	if (last?.kind !== "assistant" || last.streaming) return NONE;
	const calls = last.message.content.filter((block) => block.type === "toolCall");
	const call = calls.at(-1);
	if (!call || calls.some((block) => isInteractiveTool(block.name))) return NONE;
	const result = source.toolResults[call.id];
	if (result?.status !== "done") return NONE;
	return (
		readComposerSuggestions(call.name, call.arguments ?? {}, result.raw, disabledExtensions) ?? NONE
	);
}

export function composerSuggestionIndex(event: {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	code: string;
}): number | null {
	if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
	const match = /^Digit([1-9])$/.exec(event.code);
	return match ? Number(match[1]) - 1 : null;
}
