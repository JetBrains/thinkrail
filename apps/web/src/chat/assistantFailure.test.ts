import { afterEach, expect, test } from "bun:test";
import { applyLocale, currentTranslator } from "@thinkrail/locales/react";
import { assistantFailure, errorTurnText } from "./assistantFailure";

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
