import type { PiEvent } from "@thinkrail/contracts";
import type { ArtifactSessionEvent } from "../artifacts";
import type { ArtifactTools } from "../extensions";
import { logger } from "../log";

const log = logger("host");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roleOf(message: unknown): unknown {
	return isRecord(message) ? message.role : undefined;
}

function timestampOf(message: unknown): number {
	return isRecord(message) && typeof message.timestamp === "number"
		? message.timestamp
		: Date.now();
}

function textOf(message: unknown): string {
	if (!isRecord(message) || !Array.isArray(message.content)) return "";
	return message.content
		.flatMap((block: unknown) =>
			isRecord(block) && block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n");
}

function extract(
	toolName: string,
	run: (() => readonly string[] | undefined) | undefined,
): readonly string[] | undefined {
	if (!run) return undefined;
	try {
		return run();
	} catch (error) {
		log.warn(`artifact paths of ${toolName} could not be read`, error);
		return undefined;
	}
}

const callKey = (sessionId: string, toolCallId: string) => `${sessionId}\u0000${toolCallId}`;

export function createArtifactEventMapper(tools: () => ArtifactTools) {
	const argsByCall = new Map<string, unknown>();
	return (sessionId: string, event: PiEvent): ArtifactSessionEvent | null => {
		switch (event.type) {
			case "agent_start":
				return { type: event.type };
			case "agent_settled":
				return { type: event.type };
			case "message_end": {
				const role = roleOf(event.message);
				if (role === "user") return { type: "round_start", at: timestampOf(event.message) };
				return role === "assistant"
					? { type: "assistant_message", text: textOf(event.message) }
					: null;
			}
			case "tool_execution_start":
				if (tools().has(event.toolName))
					argsByCall.set(callKey(sessionId, event.toolCallId), event.args);
				return {
					type: event.type,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				};
			case "tool_execution_end": {
				const key = callKey(sessionId, event.toolCallId);
				const args = argsByCall.get(key);
				argsByCall.delete(key);
				const end = { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName };
				const tool = event.isError ? undefined : tools().get(event.toolName);
				if (!tool) return end;
				const details = isRecord(event.result) ? event.result.details : undefined;
				const presented = extract(
					event.toolName,
					tool.presented && (() => tool.presented?.(args, details)),
				);
				const picked = extract(event.toolName, tool.picked && (() => tool.picked?.(args, details)));
				return {
					...end,
					...(presented?.length ? { presented } : {}),
					...(picked?.length ? { picked } : {}),
				};
			}
			default:
				return null;
		}
	};
}
