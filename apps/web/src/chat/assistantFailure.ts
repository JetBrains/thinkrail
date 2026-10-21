import type { StopReason } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";

interface AssistantTerminal {
	stopReason: StopReason;
	errorMessage?: string;
}

export function assistantFailureText(
	t: Translator,
	terminal: AssistantTerminal | null | undefined,
): string | null {
	if (terminal?.stopReason === "error") {
		return terminal.errorMessage || t("chat.failure.error");
	}
	if (terminal?.stopReason === "length") {
		return t("chat.failure.truncated");
	}
	return null;
}
