import type { AssistantMessage } from "@thinkrail/contracts";
import {
	carriesComposerSuggestions,
	currentToolRegistry,
	isInteractiveTool,
	readComposerSuggestions,
	type ToolRegistry,
} from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

export interface ComposerSuggestionsSource {
	turns: readonly ChatTurn[];
	toolResults: Readonly<Record<string, ToolResultState>>;
	isStreaming: boolean;
	queue: { steering: readonly unknown[]; followUp: readonly unknown[] };
}

const NONE: readonly string[] = [];

export function endingSuggestionsCall(
	message: AssistantMessage,
	toolResults: Readonly<Record<string, ToolResultState>>,
	registry: ToolRegistry = currentToolRegistry(),
): { name: string; args: Record<string, unknown>; raw: unknown } | null {
	const calls = message.content.filter((block) => block.type === "toolCall");
	const call = calls.at(-1);
	if (!call || calls.some((block) => isInteractiveTool(block.name, registry))) return null;
	if (!carriesComposerSuggestions(call.name, registry)) return null;
	const result = toolResults[call.id];
	if (result?.status !== "done") return null;
	return { name: call.name, args: call.arguments ?? {}, raw: result.raw };
}

export function deriveComposerSuggestions(
	source: ComposerSuggestionsSource | undefined,
	disabledExtensions: readonly string[] = [],
	registry: ToolRegistry = currentToolRegistry(),
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
	const ending = endingSuggestionsCall(last.message, source.toolResults, registry);
	if (!ending) return NONE;
	return (
		readComposerSuggestions(ending.name, ending.args, ending.raw, disabledExtensions, registry) ??
		NONE
	);
}
