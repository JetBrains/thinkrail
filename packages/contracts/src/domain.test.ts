import { describe, expect, test } from "bun:test";
import {
	ACCEPTED_IMAGE_TYPES,
	base64EncodedLength,
	clampToCodePoints,
	compareResourceHistory,
	DEFAULT_CONFIG,
	FIRST_PROMPT_MAX_LENGTH,
	firstPromptHead,
	firstPromptOfTexts,
	IMAGE_MAX_BASE64_BYTES,
	interruptedResource,
	isDelegationRunDetails,
	isJbcentralConnected,
	isJbcentralQuotaRefreshSeconds,
	isLiveResource,
	isLocalePreference,
	isPlanReviewResult,
	isRetriedAttempt,
	JBCENTRAL_QUOTA_REFRESH_SECONDS,
	REQUEST_IMAGE_BASE64_BUDGET,
	type ResourceRecord,
	resourceHistoryCursor,
	resourceOutcome,
	resourceTallyTotal,
	TODO_NUDGE_PREFIX,
	tallyResources,
} from "./domain";

describe("isRetriedAttempt", () => {
	const failed = { role: "assistant", stopReason: "error" };
	const ok = { role: "assistant", stopReason: "stop" };
	const userMsg = { role: "user" };

	test("a failed assistant immediately followed by the retried assistant is superseded", () => {
		expect(isRetriedAttempt([userMsg, failed, ok], 1)).toBe(true);
	});

	test("a failed assistant followed by a user message is the run's terminal failure — visible", () => {
		expect(isRetriedAttempt([userMsg, failed, userMsg, ok], 1)).toBe(false);
	});

	test("a trailing failed assistant (nothing after it) stays visible", () => {
		expect(isRetriedAttempt([userMsg, failed], 1)).toBe(false);
	});

	test("a non-error assistant is never a retried attempt, even when another assistant follows", () => {
		expect(isRetriedAttempt([userMsg, ok, ok], 1)).toBe(false);
	});

	test("non-assistant roles and out-of-range indices are never retried attempts", () => {
		expect(isRetriedAttempt([userMsg, failed, ok], 0)).toBe(false);
		expect(isRetriedAttempt([userMsg, failed, ok], 7)).toBe(false);
	});

	test("an intervening toolResult breaks adjacency — pi's _prepareRetry re-runs the turn directly, so anything between the two means this was not a retry", () => {
		const toolResult = { role: "toolResult" };
		expect(isRetriedAttempt([userMsg, failed, toolResult, ok], 1)).toBe(false);
	});
});

describe("isPlanReviewResult", () => {
	const ok = {
		itemId: "t_1",
		itemTitle: "Wire login",
		verdict: "request_changes",
		summary: "one off-by-one",
		findings: [{ id: "c_1", kind: "inline", body: "off-by-one", path: "a.ts", startLine: 3 }],
	};

	test("accepts a well-formed verdict with findings", () => {
		expect(isPlanReviewResult(ok)).toBe(true);
		expect(isPlanReviewResult({ ...ok, verdict: "approve", findings: [] })).toBe(true);
	});

	test("rejects bad verdict, missing fields, and malformed findings", () => {
		expect(isPlanReviewResult({ ...ok, verdict: "maybe" })).toBe(false);
		expect(isPlanReviewResult({ ...ok, itemId: 1 })).toBe(false);
		expect(isPlanReviewResult({ ...ok, findings: "nope" })).toBe(false);
		expect(isPlanReviewResult({ ...ok, findings: [{ id: "c_1" }] })).toBe(false);
		expect(isPlanReviewResult(null)).toBe(false);
	});

	const finding = (extra: Record<string, unknown>) => ({
		...ok,
		findings: [{ id: "c_1", body: "b", ...extra }],
	});

	test("rejects a finding with an empty id/body or an unknown kind", () => {
		expect(isPlanReviewResult({ ...ok, findings: [{ id: "", body: "b" }] })).toBe(false);
		expect(isPlanReviewResult({ ...ok, findings: [{ id: "c_1", body: "" }] })).toBe(false);
		expect(isPlanReviewResult(finding({ kind: "nope" }))).toBe(false);
		expect(isPlanReviewResult(finding({ kind: "inline", path: "a.ts" }))).toBe(true);
	});

	test("rejects an incoherent or non-positive line range, and a line without a path", () => {
		expect(isPlanReviewResult(finding({ path: "a.ts", startLine: 0 }))).toBe(false);
		expect(isPlanReviewResult(finding({ path: "a.ts", startLine: 1.5 }))).toBe(false);
		expect(isPlanReviewResult(finding({ startLine: 3 }))).toBe(false); // line with no path
		expect(isPlanReviewResult(finding({ path: "a.ts", endLine: 3 }))).toBe(false); // endLine, no startLine
		expect(isPlanReviewResult(finding({ path: "a.ts", startLine: 5, endLine: 3 }))).toBe(false);
		expect(isPlanReviewResult(finding({ path: "a.ts", startLine: 3, endLine: 5 }))).toBe(true);
	});

	test("enforces cardinality: request_changes needs a finding, approve may have none", () => {
		expect(isPlanReviewResult({ ...ok, verdict: "request_changes", findings: [] })).toBe(false);
		expect(isPlanReviewResult({ ...ok, verdict: "approve", findings: [] })).toBe(true);
	});
});

describe("config defaults", () => {
	test("the shared custom layout-preset catalog starts empty", () => {
		expect(DEFAULT_CONFIG.customLayoutPresets).toEqual([]);
	});

	test("the composer grows to half the chat by default", () => {
		expect(DEFAULT_CONFIG).toHaveProperty("composerGrowthLimit", "half-chat");
	});

	test("JetBrains quota display defaults on with a bounded 30-second cadence", () => {
		expect(JBCENTRAL_QUOTA_REFRESH_SECONDS).toEqual({ min: 1, max: 3600, default: 30 });
		expect(DEFAULT_CONFIG).toHaveProperty("jbcentralQuotaEnabled", true);
		expect(DEFAULT_CONFIG).toHaveProperty("jbcentralQuotaRefreshSeconds", 30);
		for (const valid of [1, 30, 3600]) expect(isJbcentralQuotaRefreshSeconds(valid)).toBe(true);
		for (const invalid of [0, 3601, 1.5, "30", null]) {
			expect(isJbcentralQuotaRefreshSeconds(invalid)).toBe(false);
		}
	});

	test("chat and file lines default to 120-symbol pane-bounded measures", () => {
		expect(DEFAULT_CONFIG).toMatchObject({
			chatLineWidth: 120,
			fileLineWidth: 120,
			chatLineWidthBounded: true,
			fileLineWidthBounded: true,
		});
	});
});

describe("JetBrains Central health", () => {
	test("only configured, signed-in, non-stopped Central is connected", () => {
		expect(
			isJbcentralConnected({
				state: "configured",
				version: "1.6.2",
				signedOut: false,
				proxyStopped: false,
			}),
		).toBe(true);
		expect(
			isJbcentralConnected({
				state: "configured",
				version: "1.6.2",
				signedOut: true,
				proxyStopped: false,
			}),
		).toBe(false);
		expect(
			isJbcentralConnected({
				state: "configured",
				version: "1.6.2",
				signedOut: false,
				proxyStopped: true,
			}),
		).toBe(false);
		expect(isJbcentralConnected({ state: "supported", version: "1.6.2", signedOut: false })).toBe(
			false,
		);
	});
});

describe("image payload ceiling", () => {
	test("base64EncodedLength matches the real encoded length across quantum boundaries", () => {
		for (const n of [0, 1, 2, 3, 4, 5, 100, 3 * 1024]) {
			expect(base64EncodedLength(n)).toBe(Buffer.alloc(n).toString("base64").length);
		}
	});

	test("the shared ceiling is pi's 4.5MB encoded-base64 cap (headroom under Anthropic's 5MB API limit)", () => {
		expect(IMAGE_MAX_BASE64_BYTES).toBe(4.5 * 1024 * 1024);
	});

	test("the request-wide image budget leaves headroom under Anthropic's 32MB per-request cap", () => {
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBe(24 * 1024 * 1024);
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBeLessThan(32 * 1024 * 1024);
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBeGreaterThan(IMAGE_MAX_BASE64_BYTES * 4);
	});

	test("the provider-accepted media types are exactly png/jpeg/gif/webp", () => {
		expect([...ACCEPTED_IMAGE_TYPES].sort()).toEqual([
			"image/gif",
			"image/jpeg",
			"image/png",
			"image/webp",
		]);
	});
});

describe("isDelegationRunDetails", () => {
	const usage = {
		input: 1,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.01,
		turns: 1,
		contextTokens: 3,
	};
	const valid = {
		childSessionId: "child-1",
		task: "map the repo",
		status: "completed",
		usage,
		durationMs: 42,
	};

	test("accepts a complete details shape", () => {
		expect(
			isDelegationRunDetails({
				...valid,
				roleName: "researcher",
				roleSource: "builtin",
				model: "provider/model",
				thinkingLevel: "high",
				activity: "reading",
			}),
		).toBe(true);
	});

	test("rejects a thinking level outside pi's closed set", () => {
		expect(isDelegationRunDetails({ ...valid, thinkingLevel: "turbo" })).toBe(false);
		expect(isDelegationRunDetails({ ...valid, thinkingLevel: "toString" })).toBe(false);
	});

	test("accepts historical outcomes and optional user cancellation metadata", () => {
		expect(isDelegationRunDetails(valid)).toBe(true);
		expect(isDelegationRunDetails({ ...valid, status: "aborted", abortReason: "user" })).toBe(true);
	});

	test("rejects a status outside the closed union", () => {
		expect(isDelegationRunDetails({ ...valid, status: "done" })).toBe(false);
	});

	test("rejects an empty usage object", () => {
		expect(isDelegationRunDetails({ ...valid, usage: {} })).toBe(false);
	});

	test("rejects a missing durationMs and non-numeric usage fields", () => {
		const { durationMs: _durationMs, ...noDuration } = valid;
		expect(isDelegationRunDetails(noDuration)).toBe(false);
		expect(isDelegationRunDetails({ ...valid, usage: { ...usage, cost: "0.01" } })).toBe(false);
	});

	test("rejects every optional display field when present with a non-string value", () => {
		for (const field of ["roleName", "roleSource", "model", "activity", "abortReason"]) {
			expect(isDelegationRunDetails({ ...valid, [field]: { malformed: true } })).toBe(false);
		}
	});
});

test("isLocalePreference accepts system and canonical BCP-47 tags only", () => {
	expect(isLocalePreference("system")).toBe(true);
	expect(isLocalePreference("de")).toBe(true);
	expect(isLocalePreference("pt-BR")).toBe(true);
	expect(isLocalePreference("pt-br")).toBe(false);
	expect(isLocalePreference("")).toBe(false);
	expect(isLocalePreference("not a tag")).toBe(false);
	expect(isLocalePreference(7)).toBe(false);
});

describe("firstPromptHead", () => {
	test("takes the first non-blank line, collapses whitespace and clamps on a code point", () => {
		expect(firstPromptHead("\n\n  Fix   the\tauth bug  \nmore")).toBe("Fix the auth bug");
		expect(firstPromptHead("x".repeat(500))?.length).toBe(FIRST_PROMPT_MAX_LENGTH);
		expect(firstPromptHead(`${"x".repeat(FIRST_PROMPT_MAX_LENGTH - 1)}😀`)).toBe(
			"x".repeat(FIRST_PROMPT_MAX_LENGTH - 1),
		);
		expect(clampToCodePoints("ab😀", 3)).toBe("ab");
		expect(clampToCodePoints("ab😀", 4)).toBe("ab😀");
		expect(firstPromptHead("")).toBeUndefined();
		expect(firstPromptHead(undefined)).toBeUndefined();
	});

	test("a skill block or /skill: command reads as its request or its name, a package reads as nothing", () => {
		const block = '<skill name="setting-up-a-project" location="/s/SKILL.md">\nbody\n</skill>';
		expect(firstPromptHead(`${block}\n\nAnd also the docs`)).toBe("And also the docs");
		expect(firstPromptHead(block)).toBe("/skill:setting-up-a-project");
		expect(firstPromptHead("/skill:setting-up-a-project And also the docs")).toBe(
			"And also the docs",
		);
		expect(firstPromptHead("/skill:setting-up-a-project")).toBe("/skill:setting-up-a-project");
		expect(firstPromptHead('<review scope="branch">\n<comment …>\n</review>')).toBeUndefined();
		expect(
			firstPromptHead('<review id="r1" branch="b" base="main@abc" comments="2">\n<comment …>'),
		).toBeUndefined();
		expect(firstPromptHead("<Button> loses focus after submit")).toBe(
			"<Button> loses focus after submit",
		);
		expect(firstPromptHead(`${"word ".repeat(2_000)}`)?.length).toBe(FIRST_PROMPT_MAX_LENGTH);
	});

	test("firstPromptOfTexts skips control messages and texts without a head", () => {
		expect(
			firstPromptOfTexts([
				`${TODO_NUDGE_PREFIX}A TODO was added`,
				"",
				'<review scope="branch">\n<comment …>',
				"  The real prompt\nsecond line",
				"later",
			]),
		).toBe("The real prompt");
		expect(firstPromptOfTexts([])).toBeUndefined();
		expect(firstPromptOfTexts(['<review scope="branch">'])).toBeUndefined();
	});
});

describe("resource history vocabulary", () => {
	const command = (patch: Partial<Extract<ResourceRecord, { kind: "command" }>["summary"]>) =>
		({
			kind: "command",
			summary: {
				id: "c",
				sessionId: "s",
				name: "tests",
				command: "bun test",
				status: "completed",
				startedAt: 1_000,
				finishedAt: 2_000,
				exitCode: 0,
				...patch,
			},
		}) satisfies ResourceRecord;
	const subagent = (patch: Partial<Extract<ResourceRecord, { kind: "subagent" }>["summary"]>) =>
		({
			kind: "subagent",
			summary: {
				childSessionId: "child",
				parentSessionId: "s",
				task: "Explore",
				status: "completed",
				createdAt: new Date(5_000).toISOString(),
				...patch,
			},
		}) satisfies ResourceRecord;

	test("outcomes collapse owner statuses, and an interrupted run reads interrupted whatever it last reported", () => {
		expect(resourceOutcome(command({}))).toBe("done");
		expect(resourceOutcome(command({ exitCode: 1 }))).toBe("failed");
		expect(resourceOutcome(command({ status: "error", exitCode: 2 }))).toBe("failed");
		expect(resourceOutcome(command({ status: "stopped" }))).toBe("stopped");
		expect(resourceOutcome(command({ status: "stopping", interrupted: true }))).toBe("interrupted");
		expect(resourceOutcome(command({ status: "running" }))).toBeNull();
		expect(resourceOutcome(subagent({}))).toBe("done");
		expect(resourceOutcome(subagent({ status: "error" }))).toBe("failed");
		expect(resourceOutcome(subagent({ status: "aborted" }))).toBe("stopped");
		expect(resourceOutcome(subagent({ status: "running", interrupted: true }))).toBe("interrupted");
		expect(resourceOutcome(subagent({ status: "queued" }))).toBeNull();
	});

	test("live means a run the owner still reports in flight, never an interrupted one", () => {
		expect(isLiveResource(command({ status: "running" }))).toBe(true);
		expect(isLiveResource(command({ status: "stopping" }))).toBe(true);
		expect(isLiveResource(command({ status: "running", interrupted: true }))).toBe(false);
		expect(isLiveResource(command({}))).toBe(false);
		expect(isLiveResource(subagent({ status: "queued" }))).toBe(true);
		expect(isLiveResource(subagent({ status: "running", interrupted: true }))).toBe(false);
		expect(isLiveResource(subagent({ status: "aborted" }))).toBe(false);
	});

	test("an interrupted run goes on the wire with a terminal status an older client reads as stopped", () => {
		expect(interruptedResource(command({ status: "stopping" })).summary).toMatchObject({
			status: "stopped",
			interrupted: true,
		});
		expect(interruptedResource(command({ status: "error", exitCode: 1 })).summary).toMatchObject({
			status: "error",
			interrupted: true,
		});
		expect(interruptedResource(subagent({ status: "queued" })).summary).toMatchObject({
			status: "aborted",
			interrupted: true,
		});
		expect(resourceOutcome(interruptedResource(subagent({ status: "running" })))).toBe(
			"interrupted",
		);
	});

	test("tallies count settled runs by outcome and skip live ones", () => {
		const tally = tallyResources([
			command({}),
			command({ exitCode: 3 }),
			command({ status: "running" }),
			subagent({ status: "aborted" }),
			subagent({ status: "running", interrupted: true }),
		]);
		expect(tally).toEqual({ done: 1, failed: 1, stopped: 1, interrupted: 1 });
		expect(resourceTallyTotal(tally)).toBe(4);
	});

	test("history orders newest finish first, falls back to the start, and breaks ties by id", () => {
		expect(resourceHistoryCursor(command({}))).toEqual({ at: 2_000, id: "c" });
		expect(
			resourceHistoryCursor({
				kind: "command",
				summary: {
					id: "c",
					sessionId: "s",
					name: "dev",
					command: "bun run dev",
					status: "stopping",
					startedAt: 1_000,
					interrupted: true,
				},
			}),
		).toEqual({ at: 1_000, id: "c" });
		expect(resourceHistoryCursor(subagent({}))).toEqual({ at: 5_000, id: "child" });
		expect(resourceHistoryCursor(subagent({ finishedAt: 9_000 }))).toEqual({
			at: 9_000,
			id: "child",
		});
		const sorted = [
			{ at: 1, id: "a" },
			{ at: 3, id: "a" },
			{ at: 3, id: "b" },
			{ at: 2, id: "z" },
		].sort(compareResourceHistory);
		expect(sorted).toEqual([
			{ at: 3, id: "b" },
			{ at: 3, id: "a" },
			{ at: 2, id: "z" },
			{ at: 1, id: "a" },
		]);
	});
});
