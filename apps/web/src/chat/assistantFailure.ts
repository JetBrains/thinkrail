import type { StopReason } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";

interface AssistantTerminal {
	stopReason: StopReason;
	errorMessage?: string;
}

export type AssistantFailure = "error" | "truncated";

export function assistantFailure(
	terminal: AssistantTerminal | null | undefined,
): { failure: AssistantFailure; message: string } | null {
	if (terminal?.stopReason === "error")
		return { failure: "error", message: terminal.errorMessage ?? "" };
	if (terminal?.stopReason === "length") return { failure: "truncated", message: "" };
	return null;
}

export function errorTurnText(
	t: Translator,
	turn: { text: string; failure?: AssistantFailure | undefined },
): string {
	if (turn.failure === "truncated") return t("chat.failure.truncated");
	if (turn.failure === "error") return turn.text || t("chat.failure.error");
	return turn.text;
}
