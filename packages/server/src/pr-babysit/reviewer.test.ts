import { expect, test } from "bun:test";
import type { PrBabysitItem } from "@thinkrail/contracts";
import {
	parsePatchVerdict,
	parseReviewFindings,
	READ_ONLY_REVIEWER_TOOLS,
	renderGithubReview,
	specPathsFor,
} from "./reviewer";

test("reviewer tools are read-only", () => {
	for (const tool of ["write", "edit", "bash"])
		expect(READ_ONLY_REVIEWER_TOOLS).not.toContain(tool);
});

test("parses the last fenced findings block and drops invalid entries", () => {
	const text = [
		"Thinking",
		"```json",
		"[]",
		"```",
		"Final:",
		"```json",
		JSON.stringify([
			{ path: "a.ts", line: 3, severity: "Blocker", summary: "x is null", suggested_fix: "guard" },
			{ severity: "suggestion", summary: "rename", suggestedFix: "y" },
			{ severity: "nit", summary: "bad severity" },
			{ severity: "warning", summary: "  " },
			{ severity: "warning", summary: "bad line", line: -1 },
		]),
		"```",
	].join("\n");
	expect(parseReviewFindings(text)).toEqual([
		{ path: "a.ts", line: 3, severity: "blocker", summary: "x is null", suggestedFix: "guard" },
		{ severity: "suggestion", summary: "rename", suggestedFix: "y" },
		{ severity: "warning", summary: "bad line" },
	]);
});

test("accepts a findings object and a bare array; rejects garbage", () => {
	expect(parseReviewFindings('{"findings":[{"severity":"warning","summary":"s"}]}')).toHaveLength(
		1,
	);
	expect(parseReviewFindings('ok [{"severity":"warning","summary":"s"}] done')).toHaveLength(1);
	expect(parseReviewFindings("no json here")).toBeNull();
	expect(parseReviewFindings("```json\n{nope\n```")).toBeNull();
	expect(parseReviewFindings("```json\n[]\n```")).toEqual([]);
});

test("patch verdict rejects only on an explicit reject", () => {
	expect(parsePatchVerdict('```json\n{"verdict":"reject","reason":"wrong file"}\n```')).toEqual({
		approved: false,
		reason: "wrong file",
	});
	expect(parsePatchVerdict(null).approved).toBe(true);
	expect(parsePatchVerdict("garbage").approved).toBe(true);
});

test("spec discovery walks each changed path up to the root", () => {
	const present = new Set(["SPEC.md", "packages/server/SPEC.md", "packages/server/src/pr/SPEC.md"]);
	expect(
		specPathsFor(
			["packages/server/src/pr/pr.ts", "packages/server/src/pr/x.ts", "README.md"],
			(path) => present.has(path),
		),
	).toEqual(["packages/server/src/pr/SPEC.md", "packages/server/SPEC.md", "SPEC.md"]);
});

test("a GitHub review inlines anchored findings and requests changes on a blocker", () => {
	const item = (patch: Partial<PrBabysitItem>): PrBabysitItem => ({
		itemId: "i",
		source: "independent_review",
		itemType: "finding",
		summary: "s",
		status: "pending_review_approval",
		updatedAt: 0,
		...patch,
	});
	const review = renderGithubReview([
		item({ path: "a.ts", line: 2, severity: "blocker" }),
		item({ severity: "suggestion", summary: "loose" }),
	]);
	expect(review.event).toBe("REQUEST_CHANGES");
	expect(review.comments).toHaveLength(1);
	expect(review.comments[0]?.body).toStartWith("[helios-review] **Blocker:**");
	expect(review.body).toContain("loose");
	expect(review.body).toStartWith("[helios-review]");
});
