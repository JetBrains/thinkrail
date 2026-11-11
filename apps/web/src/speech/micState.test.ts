import { expect, test } from "bun:test";
import type { SpeechStatus } from "@thinkrail/contracts";
import { micState } from "./micState";

const base: SpeechStatus = {
	supported: true,
	install: { status: "not-installed" },
	runtime: null,
	engine: "stopped",
	diskBytes: 0,
	downloadBytes: { multilingual: 750_000_000, english: 708_000_000 },
};

test("an older host shows no mic at all", () => {
	expect(micState(null, "available", null)).toEqual({ kind: "hidden" });
});

test("a platform, browser or origin that cannot dictate shows a disabled mic with its reason", () => {
	expect(micState({ ...base, supported: false }, "available", null)).toEqual({
		kind: "unavailable",
		reason: "unsupported-platform",
	});
	expect(micState(base, "insecure-origin", null)).toEqual({
		kind: "unavailable",
		reason: "insecure-origin",
	});
	expect(micState(base, "unsupported", null)).toEqual({
		kind: "unavailable",
		reason: "unsupported-browser",
	});
});

test("a blocked microphone stays clickable so the user can retry after allowing it", () => {
	const ready = { ...base, install: { status: "ready" as const, model: "multilingual" as const } };
	expect(micState(ready, "available", "denied")).toEqual({ kind: "blocked", reason: "denied" });
	expect(micState(ready, "available", "no-device")).toEqual({
		kind: "blocked",
		reason: "no-device",
	});
	expect(micState(base, "available", "denied")).toMatchObject({ kind: "offer" });
});

test("before the download the mic offers the multilingual model with its size", () => {
	expect(micState(base, "available", null)).toEqual({
		kind: "offer",
		model: "multilingual",
		downloadBytes: 750_000_000,
		failed: null,
	});
});

test("a failed install offers a retry of the same model unless an older one still works", () => {
	const failed = {
		...base,
		install: {
			status: "failed" as const,
			model: "english" as const,
			code: "SPEECH_DOWNLOAD_FAILED" as const,
			usable: null,
		},
	};
	expect(micState(failed, "available", null)).toEqual({
		kind: "offer",
		model: "english",
		downloadBytes: 708_000_000,
		failed: "SPEECH_DOWNLOAD_FAILED",
	});
	expect(
		micState(
			{ ...failed, install: { ...failed.install, usable: "multilingual" as const } },
			"available",
			null,
		),
	).toEqual({ kind: "ready" });
});

test("installing reports progress and ready lets the user dictate", () => {
	expect(
		micState(
			{
				...base,
				install: {
					status: "installing",
					model: "multilingual",
					phase: "model",
					receivedBytes: 10,
					totalBytes: 100,
				},
			},
			"available",
			null,
		),
	).toEqual({ kind: "installing", receivedBytes: 10, totalBytes: 100 });
	expect(
		micState({ ...base, install: { status: "ready", model: "english" } }, "available", null),
	).toEqual({ kind: "ready" });
});
