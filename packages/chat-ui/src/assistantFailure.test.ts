import { afterEach, expect, test } from "bun:test";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import {
	assistantFailure,
	CLAUDE_USAGE_URL,
	errorTurnText,
	subscriptionLimit,
} from "./assistantFailure";

afterEach(() => applyLocale("en", {}));

test("a run's failure is recorded as a kind plus the provider's own message", () => {
	expect(assistantFailure({ stopReason: "error", errorMessage: "429 rate limited" })).toEqual({
		failure: "error",
		message: "429 rate limited",
	});
	expect(assistantFailure({ stopReason: "length" })).toEqual({ failure: "truncated", message: "" });
	expect(assistantFailure({ stopReason: "stop" })).toBeNull();
});

test("notices translate at render; a provider message stays verbatim", () => {
	applyLocale("de", {
		de: {
			"chat.failure.error": "Der Lauf endete mit einem Fehler.",
			"chat.failure.truncated": "Die Antwort wurde abgeschnitten.",
		},
	});
	const t = currentTranslator();
	expect(errorTurnText(t, { text: "", failure: "error" })).toBe(
		"Der Lauf endete mit einem Fehler.",
	);
	expect(errorTurnText(t, { text: "", failure: "truncated" })).toBe(
		"Die Antwort wurde abgeschnitten.",
	);
	expect(errorTurnText(t, { text: "429 rate limited", failure: "error" })).toBe("429 rate limited");
	expect(errorTurnText(t, { text: "Couldn't send the message" })).toBe("Couldn't send the message");
});

test("a provider's model-unavailable error leads with a pick-another-model notice and keeps the provider text", () => {
	const t = currentTranslator();
	const errors = [
		'OpenAI API error (400): {"type":"invalid_request_error","code":"model_not_found","message":"The \'gpt-4\' model is not supported when using Codex with a ChatGPT account."}',
		'404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}',
		"404 The model `gpt-x` does not exist or you do not have access to it.",
		"404 No endpoints found for apodex/apodex-1.1-mini:free.",
		"You don't have access to the model with the specified model ID.",
	];
	for (const text of errors)
		expect(errorTurnText(t, { text, failure: "error" })).toBe(
			`${t("chat.failure.modelUnavailable")}\n\n${text}`,
		);
	expect(errorTurnText(t, { text: "429 rate limited", failure: "error" })).toBe("429 rate limited");
	expect(errorTurnText(t, { text: "model_not_found" })).toBe("model_not_found");
});

test("a subscription-limit error resolves to the provider's usage page and keeps its text verbatim", () => {
	const t = currentTranslator();
	const claude =
		'400 {"type":"error","error":{"type":"invalid_request_error","message":"Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011CgYFw5EqMVmQ8L5y3bZ4k"}';
	expect(subscriptionLimit({ text: claude, failure: "error" })).toEqual({
		url: CLAUDE_USAGE_URL,
		label: "chat.extraUsage.manage",
	});
	expect(errorTurnText(t, { text: claude, failure: "error" })).toBe(claude);
	const chatgpt = [
		'OpenAI API error (429): {"code":"subscription_sharing_usage_limit_exceeded","message":"The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead."}\nCheck your ChatGPT usage: https://chatgpt.com/settings/usage',
		"The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.",
		'OpenAI API error (429): {"code":"subscription_sharing_workplace_individual_usage_limit_exceeded"}',
		"You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min.",
	];
	for (const text of chatgpt)
		expect(subscriptionLimit({ text, failure: "error" })).toEqual({
			url: "https://chatgpt.com/settings/usage",
			label: "chat.failure.checkChatgptUsage",
		});
	expect(subscriptionLimit({ text: "429 rate limited", failure: "error" })).toBeNull();
	expect(subscriptionLimit({ text: chatgpt[1] ?? "" })).toBeNull();
});
