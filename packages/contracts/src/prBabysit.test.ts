import { expect, test } from "bun:test";
import {
	DEFAULT_PR_BABYSIT_CONFIG,
	normalizePrBabysitConfig,
	PR_BABYSIT_MAX_PUSH_CYCLES,
	prBabysitConfigPatchProblem,
} from "./prBabysit";
import {
	PR_BABYSIT_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	WS_CHANNELS,
	WS_METHODS,
} from "./wsProtocol";

test("PR babysit wire surface is versioned", () => {
	expect(PR_BABYSIT_PROTOCOL_VERSION).toBe(125);
	expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(PR_BABYSIT_PROTOCOL_VERSION);
	expect(WS_CHANNELS.prBabysitChanged).toBe("prBabysit.changed");
	expect(WS_METHODS.prBabysitStart).toBe("prBabysit.start");
});

test("defaults cap autonomous pushes at five", () => {
	expect(DEFAULT_PR_BABYSIT_CONFIG.maxPushCycles).toBe(5);
	expect(PR_BABYSIT_MAX_PUSH_CYCLES.default).toBe(5);
});

test("normalize keeps valid fields and defaults each malformed one", () => {
	expect(normalizePrBabysitConfig(undefined)).toEqual(DEFAULT_PR_BABYSIT_CONFIG);
	const reviewerModel = { provider: "anthropic", id: "claude-haiku" };
	const normalized = normalizePrBabysitConfig({
		mode: "auto_push",
		independentReviewMode: "bogus",
		maxPushCycles: 0,
		autoResolveThreads: true,
		reviewerModel,
	});
	expect(normalized.mode).toBe("auto_push");
	expect(normalized.independentReviewMode).toBe(DEFAULT_PR_BABYSIT_CONFIG.independentReviewMode);
	expect(normalized.maxPushCycles).toBe(5);
	expect(normalized.autoResolveThreads).toBe(true);
	expect(normalized.reviewerModel?.provider).toBe("anthropic");
	expect(normalized.reviewerModel?.id).toBe("claude-haiku");
});

test("a patch is refused on an unknown or invalid field", () => {
	expect(
		prBabysitConfigPatchProblem({ mode: "stage_for_approval", babysitModel: null }),
	).toBeNull();
	expect(prBabysitConfigPatchProblem({ maxPushCycles: 2.5 })).toContain("maxPushCycles");
	expect(prBabysitConfigPatchProblem({ nope: true })).toContain("unknown");
	expect(prBabysitConfigPatchProblem([])).not.toBeNull();
});
