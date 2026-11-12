import type { AskUserQuestionResult } from "@thinkrail/pi-ask-user-question/core";

function isResult(value: unknown): value is AskUserQuestionResult {
	return (
		!!value &&
		typeof value === "object" &&
		Array.isArray((value as AskUserQuestionResult).answers) &&
		typeof (value as AskUserQuestionResult).cancelled === "boolean"
	);
}

export function readAskUserQuestionResult(raw: unknown): AskUserQuestionResult | null {
	const details =
		raw && typeof raw === "object" ? (raw as { details?: unknown }).details : undefined;
	if (isResult(details)) return details;
	return isResult(raw) ? raw : null;
}
