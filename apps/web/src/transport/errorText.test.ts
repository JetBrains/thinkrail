import { expect, test } from "bun:test";
import { t } from "@thinkrail/locales/react";
import { errorText } from "./errorText";
import { RequestError } from "./requestError";

test("a full replay namespace reads as plain text, not the host's wire message", () => {
	const text = errorText(
		new RequestError(
			"REQUEST_REPLAY_OVERFLOW",
			"replay namespace is full: unacknowledged results must be read first",
		),
	);
	expect(text).toBe(t("app.transport.replayOverflow"));
	expect(text).not.toContain("replay namespace");
});

test("other failures keep the host's message, and non-errors keep the fallback", () => {
	expect(errorText(new RequestError("RESOURCE_UNAVAILABLE", "gone"))).toBe("gone");
	expect(errorText(new Error("boom"))).toBe("boom");
	expect(errorText(undefined)).toBe(t("app.transport.requestFailedFallback"));
});
