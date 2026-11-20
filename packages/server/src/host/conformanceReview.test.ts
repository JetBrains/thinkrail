import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireModel, Workspace } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import { getReviewSnapshot } from "../reviews";
import { resetConfigCache, updateConfig } from "../settings";
import {
	conformanceTask,
	fileExtensionComments,
	parseConformance,
	runConformanceReview,
} from "./conformanceReview";
import type { ReviewRunner } from "./requestReview";
import { CONFORMANCE_SYSTEM_PROMPT, REVIEWER_TOOLS } from "./reviewerRole";

const WS = "ws-conformance";
let dataDir: string;
let worktree: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "conformance-data-"));
	worktree = mkdtempSync(join(tmpdir(), "conformance-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	writeFileSync(join(worktree, "greet.ts"), "export const greet = 1;\nexport const bye = 2;\n");
	saveWorkspaces([
		{
			id: WS,
			projectId: "p1",
			name: "w",
			branch: "feature",
			baseBranch: "main",
			worktreePath: worktree,
			createdAt: 0,
		} as Workspace,
	]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

const requirements = [
	{ id: "ac-1", text: "Greets in French" },
	{ id: "os-auth", text: "TOTP enrollment", scenarios: ["WHEN a user scans\nTHEN it enrolls"] },
];

const fenced = (value: unknown) => `Checked.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

const verdict = {
	summary: " One requirement is missing. ",
	items: [
		{ id: "os-auth", verdict: "untested", evidence: [{ path: "greet.ts", line: 2, note: "here" }] },
		{
			id: "ac-1",
			verdict: "unmet",
			evidence: [{ path: ".\\src\\greet.ts", line: 1, note: "no French" }],
			tests: ["greet.test.ts", 3],
		},
		{ id: "extra", verdict: "met" },
	],
};

describe("parseConformance", () => {
	test("orders one item per requirement, normalizes paths and drops unknown ids", () => {
		expect(parseConformance(fenced(verdict), requirements)).toEqual({
			summary: "One requirement is missing.",
			items: [
				{
					id: "ac-1",
					verdict: "unmet",
					evidence: [{ path: "src/greet.ts", line: 1, note: "no French" }],
					tests: ["greet.test.ts"],
				},
				{
					id: "os-auth",
					verdict: "untested",
					evidence: [{ path: "greet.ts", line: 2, note: "here" }],
					tests: [],
				},
			],
		});
	});

	test("reads the last fenced block, and the raw text without one", () => {
		const early = fenced({ items: [] });
		expect(parseConformance(`${early}\n${fenced(verdict)}`, requirements)?.items).toHaveLength(2);
		expect(parseConformance(JSON.stringify(verdict), requirements)?.items).toHaveLength(2);
	});

	test("rejects a missing or repeated requirement, a bad verdict, a bad line or a non-object", () => {
		const items = verdict.items.slice(0, 2);
		const variants: unknown[] = [
			{ items: [items[0]] },
			{ items: [...items, items[1]] },
			{ items: [{ ...items[0], verdict: "approve" }, items[1]] },
			{ items: [{ ...items[0], evidence: [{ path: "a.ts", line: 0, note: "" }] }, items[1]] },
			{ items: [{ ...items[0], evidence: [{ path: " ", note: "" }] }, items[1]] },
			{ items: [{ ...items[0], evidence: "a.ts" }, items[1]] },
			{ items, summary: 3 },
			[],
		];
		for (const variant of variants)
			expect(parseConformance(fenced(variant), requirements)).toBeNull();
		expect(parseConformance("no json here", requirements)).toBeNull();
		expect(parseConformance(undefined, requirements)).toBeNull();
	});
});

test("the task names the context, the base to diff against and every requirement with its scenarios", () => {
	const task = conformanceTask({ baseBranch: "main", requirements, context: "Card TR-1: greet" });
	expect(task).toContain("## Context\n\nCard TR-1: greet");
	expect(task).toContain("git diff main...HEAD");
	expect(task).toContain("- [ac-1] Greets in French");
	expect(task).toContain(
		"- [os-auth] TOTP enrollment\n  - Scenario: WHEN a user scans\n    THEN it enrolls",
	);
	expect(conformanceTask({ baseBranch: "main", requirements, context: " " })).not.toContain(
		"## Context",
	);
});

describe("runConformanceReview", () => {
	const reviewModel = {
		provider: "acme",
		id: "reviewer",
		name: "Reviewer",
		thinkingLevels: ["low", "high"],
	} as WireModel;

	test("runs plan review's reviewer child with the conformance role on the reviewer model, forwarding the signal", async () => {
		updateConfig({ reviewModel, reviewEffort: "high" });
		const controller = new AbortController();
		const calls: Parameters<ReviewRunner>[] = [];
		const answer = {
			...verdict,
			items: [
				verdict.items[1],
				{
					id: "os-auth",
					verdict: "untested",
					evidence: [{ path: join(worktree, "lib", "x.ts"), note: "" }],
				},
			],
		};
		const runner: ReviewRunner = async (...args) => {
			calls.push(args);
			return { childSessionId: "child", status: "completed", finalText: fenced(answer) };
		};
		const result = await runConformanceReview(
			{
				workspaceId: WS,
				sessionId: "s1",
				worktreePath: worktree,
				baseBranch: "main",
				requirements,
				context: "",
				signal: controller.signal,
			},
			runner,
		);
		expect(result.items.map((item) => item.verdict)).toEqual(["unmet", "untested"]);
		expect(result.items.map((item) => item.evidence[0]?.path)).toEqual([
			"src/greet.ts",
			"lib/x.ts",
		]);
		const [workspaceId, sessionId, task, role, signal] = calls[0] ?? [];
		expect([workspaceId, sessionId]).toEqual([WS, "s1"]);
		expect(task).toContain("[os-auth]");
		expect(role).toEqual({
			systemPrompt: CONFORMANCE_SYSTEM_PROMPT,
			tools: REVIEWER_TOOLS,
			info: { createdBy: "extension:reviewConformance", roleName: "conformance-reviewer" },
			model: { provider: "acme", id: "reviewer" },
			thinkingLevel: "high",
		});
		expect(role?.tools).not.toContain("edit");
		expect(role?.tools).not.toContain("write");
		expect(signal).toBe(controller.signal);
	});

	test("a run that did not complete or answered no valid verdict fails", async () => {
		updateConfig({ reviewModel, reviewEffort: "low" });
		const input = {
			workspaceId: WS,
			sessionId: "s1",
			worktreePath: worktree,
			baseBranch: "main",
			requirements,
			context: "",
			signal: new AbortController().signal,
		};
		await expect(
			runConformanceReview(input, async () => ({ childSessionId: "c", status: "aborted" })),
		).rejects.toThrow("did not complete (aborted)");
		await expect(
			runConformanceReview(input, async () => ({
				childSessionId: "c",
				status: "completed",
				finalText: fenced({ items: [] }),
			})),
		).rejects.toThrow("valid verdict");
	});
});

test("extension comments land as labelled agent remarks, anchored where the line resolves", async () => {
	const filed = await fileExtensionComments(WS, "Smart review", [
		{ path: "greet.ts", line: 1, side: "worktree", text: "Unmet: greets in French" },
		{ path: "greet.ts", line: 99, side: "worktree", text: "Unmet: past the end" },
		{ path: "missing.ts", line: 1, side: "worktree", text: "Unmet: no such file" },
	]);
	expect(filed.map((comment) => comment.anchored)).toEqual([true, false, false]);
	const { comments } = await getReviewSnapshot(WS);
	expect(comments.map((comment) => [comment.kind, comment.author, comment.authorLabel])).toEqual([
		["inline", "agent", "Smart review"],
		["review", "agent", "Smart review"],
		["review", "agent", "Smart review"],
	]);
	expect(comments[0]?.anchor?.path).toBe("greet.ts");
	expect(comments[0]?.anchor?.selectors[0]).toEqual({
		kind: "lineRange",
		startLine: 1,
		endLine: 1,
	});
	expect(comments[1]?.body).toBe("greet.ts:99 — Unmet: past the end");
	expect(comments.every((comment) => comment.status === "draft")).toBe(true);
});
