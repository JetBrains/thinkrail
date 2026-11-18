import { describe, expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { openingTarget, reconcileModel } from "./NewWorkspaceDialog";

const wm = (
	provider: string,
	id: string,
	thinkingLevels: WireModel["thinkingLevels"],
): WireModel => ({
	id,
	name: id,
	provider,
	contextWindow: 200_000,
	reasoning: thinkingLevels.length > 1,
	thinkingLevels,
});

describe("reconcileModel", () => {
	const held = wm("anthropic", "opus-5", ["off", "low", "medium", "high"]);

	test("re-points to the refreshed object for the same {provider,id}", () => {
		const refreshed = wm("anthropic", "opus-5", ["off", "low", "medium", "high", "xhigh"]);
		const next = reconcileModel([wm("openai", "o9", ["off"]), refreshed], held, true);
		expect(next).toBe(refreshed);
	});

	test("id match requires the provider too (same id under two providers)", () => {
		const bedrockTwin = wm("bedrock", "opus-5", ["off", "medium"]);
		const anthropicOriginal = wm("anthropic", "opus-5", ["off", "high"]);
		expect(reconcileModel([bedrockTwin, anthropicOriginal], held, true)).toBe(anthropicOriginal);
	});

	test("a NON-authoritative catalog never declares a model gone — it can't override the host's default", () => {
		const stale = [wm("openai", "o9", ["off"])];
		expect(reconcileModel(stale, wm("anthropic", "opus-6", ["off", "high"]), false)).toBeNull();
	});

	test("an AUTHORITATIVE catalog reports the model gone — without naming a replacement", () => {
		expect(reconcileModel([wm("openai", "o9", ["off"])], held, true)).toBe("unavailable");
	});

	test("null on an empty catalog, authoritative or not (the caller keeps what it has)", () => {
		expect(reconcileModel([], held, true)).toBeNull();
		expect(reconcileModel([], held, false)).toBeNull();
	});

	test("settles: reconciling an already-reconciled model is a no-op", () => {
		const models = [wm("anthropic", "opus-5", ["off", "low", "medium", "high"])];
		const settled = reconcileModel(models, held, true);
		if (!settled || settled === "unavailable") throw new Error("unexpected reconciliation");
		expect(reconcileModel(models, settled, true)).toBe(settled);
	});
});

describe("openingTarget", () => {
	const base = { projectId: "p1", requested: undefined, canReview: true, retryingReview: false };

	test("opens where it always did unless the review mode is asked for", () => {
		expect(openingTarget(base)).toBe("worktree");
		expect(openingTarget({ ...base, projectId: null })).toBe("chat");
	});

	test("the palette's review row and a failed review's retry open the review mode", () => {
		expect(openingTarget({ ...base, requested: "review" })).toBe("review");
		expect(openingTarget({ ...base, projectId: null, requested: "review" })).toBe("review");
		expect(openingTarget({ ...base, retryingReview: true })).toBe("review");
	});

	test("a host or a workspace list that cannot review never opens the review mode", () => {
		expect(openingTarget({ ...base, canReview: false, requested: "review" })).toBe("worktree");
		expect(openingTarget({ ...base, canReview: false, retryingReview: true })).toBe("worktree");
	});
});
