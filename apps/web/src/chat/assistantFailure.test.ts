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
