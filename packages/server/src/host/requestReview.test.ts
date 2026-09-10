import { expect, test } from "bun:test";
import type { PlanReviewResult } from "@thinkrail/contracts";
import { composeText, parseVerdict } from "./requestReview";

const ID = "t_1";
const TITLE = "Wire login redirect";

test("parseVerdict extracts a fenced json verdict and stamps host-owned id/title", () => {
	const finalText = [
		"Here is my review.",
		"```json",
		'{ "verdict": "request_changes", "summary": "off-by-one", "findings": [',
		'  { "id": "f1", "path": "src/a.ts", "startLine": 4, "endLine": 6, "body": "loop bound" } ] }',
		"```",
	].join("\n");
	const result = parseVerdict(finalText, ID, TITLE);
	expect(result).not.toBeNull();
	expect(result?.itemId).toBe(ID);
	expect(result?.itemTitle).toBe(TITLE);
	expect(result?.verdict).toBe("request_changes");
	expect(result?.findings[0]).toEqual({
		id: "f1",
		kind: "inline",
		body: "loop bound",
		path: "src/a.ts",
		startLine: 4,
		endLine: 6,
	});
});

test("parseVerdict accepts an approve with no findings and no fence (bare json)", () => {
	const result = parseVerdict('{ "verdict": "approve", "findings": [] }', ID, TITLE);
	expect(result?.verdict).toBe("approve");
	expect(result?.findings).toEqual([]);
});

test("parseVerdict rejects malformed / missing / bad-verdict output", () => {
	expect(parseVerdict(undefined, ID, TITLE)).toBeNull();
	expect(parseVerdict("no json here", ID, TITLE)).toBeNull();
	expect(parseVerdict("```json\nnot json\n```", ID, TITLE)).toBeNull();
	expect(parseVerdict('{ "verdict": "maybe", "findings": [] }', ID, TITLE)).toBeNull();
	expect(
		parseVerdict('{ "verdict": "approve", "findings": [ { "id": "f1" } ] }', ID, TITLE),
	).toBeNull();
});

const CHANGES: PlanReviewResult = {
	itemId: "t_1",
	itemTitle: "Wire login",
	verdict: "request_changes",
	summary: "one bug",
	findings: [
		{ id: "f1", kind: "inline", body: "off-by-one", path: "a.ts", startLine: 4, endLine: 6 },
	],
};

test("composeText tracks the fix budget: a live cycle tells the worker to fix, a spent one to wait", () => {
	const on = composeText(CHANGES, true);
	expect(on).toContain("REQUEST_CHANGES");
	expect(on).toContain("request_review again");
	expect(on).toContain("[f1] (a.ts:4-6) off-by-one");

	const off = composeText(CHANGES, false);
	expect(off).toContain("spent or auto-fix is off");
	expect(off).toContain("do NOT fix now");
	expect(off).not.toContain("request_review again");
});

test("composeText for approve names the step and never asks for a fix", () => {
	const text = composeText({ ...CHANGES, verdict: "approve", findings: [] }, true);
	expect(text).toContain("APPROVE");
	expect(text).not.toContain("REQUEST_CHANGES");
});

test("parseVerdict defaults a finding's kind and drops absent location fields", () => {
	const result = parseVerdict(
		'{ "verdict": "request_changes", "findings": [ { "id": "f1", "body": "no location" } ] }',
		ID,
		TITLE,
	);
	expect(result?.findings[0]).toEqual({ id: "f1", kind: "inline", body: "no location" });
});
