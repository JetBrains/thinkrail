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

const MODEL_UNAVAILABLE = [
	/model_not_found/,
	/"not_found_error"[^}]*"model: /,
	/does not exist or you do not have access to it/,
	/is not supported when using Codex/,
	/No endpoints found/,
	/You don't have access to the model/,
	/The requested model is not supported/,
];

export function isModelUnavailableError(message: string): boolean {
	return MODEL_UNAVAILABLE.some((pattern) => pattern.test(message));
}

export const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

export interface SubscriptionLimit {
	url: string;
	label: "chat.extraUsage.manage" | "chat.failure.checkChatgptUsage";
}

const SUBSCRIPTION_LIMITS: (SubscriptionLimit & { pattern: RegExp })[] = [
	{
		pattern: /Third-party apps now draw from your extra usage/,
		url: CLAUDE_USAGE_URL,
		label: "chat.extraUsage.manage",
	},
	{
		pattern:
			/subscription_sharing_(?:workplace_individual_)?usage_limit_exceeded|Subscription Sharing usage limit|You have hit your ChatGPT usage limit/,
		url: CHATGPT_USAGE_URL,
		label: "chat.failure.checkChatgptUsage",
	},
];

export function subscriptionLimit(turn: {
	text: string;
	failure?: AssistantFailure | undefined;
}): SubscriptionLimit | null {
	if (turn.failure !== "error") return null;
	const match = SUBSCRIPTION_LIMITS.find(({ pattern }) => pattern.test(turn.text));
	return match ? { url: match.url, label: match.label } : null;
}

export function errorTurnText(
	t: Translator,
	turn: { text: string; failure?: AssistantFailure | undefined },
): string {
	if (turn.failure === "truncated") return t("chat.failure.truncated");
	if (turn.failure === "error" && isModelUnavailableError(turn.text))
		return `${t("chat.failure.modelUnavailable")}\n\n${turn.text}`;
	if (turn.failure === "error") return turn.text || t("chat.failure.error");
	return turn.text;
}
