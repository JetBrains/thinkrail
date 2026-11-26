import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import {
	buildStatsHotspots,
	hotspotAction,
	isNotesFile,
	isSpecFile,
	isTestFile,
	parseHotspotsParams,
} from "./hotspots.ts";

const root = tempDir("hotspots");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const READY = { phase: "ready", indexed: 0, total: 0 } as const;
const day = (date: number) => new Date(2026, 10, date, 10).getTime();

type Op = readonly [tool: "read" | "edit" | "write", path: string, failed?: boolean];

function session(id: string, cwd: string, date: number, ops: readonly Op[]): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id, cwd, start: day(date) });
	builder.user(`work ${id}`);
	ops.forEach(([tool, path, failed], at) => {
		const callId = `${id}-${at}`;
		builder.assistant({
			toolCalls: [
				{
					id: callId,
					name: tool,
					arguments: tool === "write" ? { path, content: "a\nb\n" } : { path },
				},
			],
		});
		builder.toolResult({
			toolCallId: callId,
			toolName: tool,
			isError: failed === true,
			...(tool === "edit" && !failed
				? { details: { diff: "", patch: "--- a\n+++ b\n@@\n-x\n+y\n+z" } }
				: {}),
		});
	});
	return builder;
}

const times = (count: number, op: Op): Op[] => Array.from({ length: count }, () => op);

async function corpus() {
	const files = [
		writeSession(
			root,
			"s1",
			session("s1", "/work/a", 1, [
				["edit", "docs/SPEC.md"],
				...times(5, ["edit", "src/a.test.ts"]),
				...times(10, ["edit", "src/big.ts"]),
				["edit", "src/hub.ts"],
				["read", "README.md"],
				["write", ".notes/pr-body.md"],
				["read", "node_modules/x/index.js"],
				["read", "/etc/hosts"],
				["edit", "src/hub.ts", true],
			]),
		),
		writeSession(
			root,
			"s2",
			session("s2", "/work/a", 2, [
				["edit", "docs/SPEC.md"],
				["edit", "src/hub.ts"],
				["read", "README.md"],
				["write", ".notes/pr-body.md"],
				...times(5, ["edit", ".notes/plan.md"]),
			]),
		),
		writeSession(
			root,
			"s3",
			session("s3", "/work/a2", 3, [
				["edit", "docs/SPEC.md"],
				["edit", "src/hub.ts"],
				["read", "README.md"],
				["write", ".notes/pr-body.md"],
				...times(6, ["edit", "src/re.ts"]),
			]),
		),
		writeSession(root, "s4", session("s4", "/work/a", 4, [["read", "README.md"]])),
		writeSession(root, "s5", session("s5", "/work/b", 5, [["read", "README.md"]])),
	];
	return statsOver(files);
}

describe("hotspot rules", () => {
	test("classify tests, specs and notes files", () => {
		expect(isTestFile("src/a.test.ts")).toBe(true);
		expect(isTestFile("e2e/layout.spec.ts")).toBe(true);
		expect(isTestFile("pkg/tests/helper.py")).toBe(true);
		expect(isTestFile("src/contest.ts")).toBe(false);
		expect(isSpecFile("apps/web/SPEC.md")).toBe(true);
		expect(isSpecFile("README.md")).toBe(false);
		expect(isNotesFile(".thinkrail/context/plan.md")).toBe(true);
		expect(isNotesFile("docs/plan.md")).toBe(false);
		expect(isNotesFile(".github/workflows/ci.yml")).toBe(false);
	});

	test("the first matching rule names the action", () => {
		const base = { reads: 0, touches: 10, sessions: 1, changedSessions: 1, rework: 0 };
		expect(hotspotAction({ ...base, path: "x/SPEC.md", changedSessions: 3, rework: 12 })).toBe(
			"spec",
		);
		expect(hotspotAction({ ...base, path: "x/SPEC.md", changedSessions: 2 })).toBe("none");
		expect(hotspotAction({ ...base, path: "a.test.ts", rework: 12 })).toBe("test");
		expect(hotspotAction({ ...base, path: ".n/plan.md", rework: 5 })).toBe("plan");
		expect(hotspotAction({ ...base, path: ".n/pr.md", changedSessions: 3 })).toBe("template");
		expect(hotspotAction({ ...base, path: "a.ts", rework: 10, changedSessions: 4 })).toBe("split");
		expect(hotspotAction({ ...base, path: "a.ts", rework: 9, changedSessions: 3 })).toBe("hub");
		expect(hotspotAction({ ...base, path: "a.md", reads: 7, touches: 10, sessions: 4 })).toBe(
			"upfront",
		);
		expect(hotspotAction({ ...base, path: "a.md", reads: 6, touches: 10, sessions: 4 })).toBe(
			"none",
		);
		expect(hotspotAction({ ...base, path: "a.ts", rework: 5 })).toBe("review");
		expect(hotspotAction({ ...base, path: "a.ts", rework: 4 })).toBe("none");
	});

	test("params take a scope and an optional sort", () => {
		expect(parseHotspotsParams({ scope: { kind: "all" }, sort: "changes" })).toEqual({
			scope: { kind: "all" },
			sort: "changes",
		});
		expect(() => parseHotspotsParams({ scope: { kind: "all" }, sort: "size" })).toThrow();
	});
});

describe("stats.hotspots", () => {
	test("ranks files by touches across sessions with one action each and folders summed", async () => {
		const { input } = await corpus();
		const { hotspots, sessions } = await buildStatsHotspots(input, READY, {
			scope: { kind: "all" },
		});
		expect(sessions.map((session) => session.sessionId)).toEqual(["s5", "s4", "s3", "s2", "s1"]);
		const actions = Object.fromEntries(
			hotspots.files.map((file) => [`${file.projectId}:${file.path}`, file.action]),
		);
		expect(actions).toEqual({
			"p1:src/big.ts": "split",
			"p1:src/re.ts": "review",
			"p1:src/a.test.ts": "test",
			"p1:.notes/plan.md": "plan",
			"p1:README.md": "upfront",
			"p1:src/hub.ts": "hub",
			"p1:docs/SPEC.md": "spec",
			"p1:.notes/pr-body.md": "template",
			"p2:README.md": "none",
		});
		expect(hotspots.files.map((file) => file.path).slice(0, 4)).toEqual([
			"src/big.ts",
			"src/re.ts",
			".notes/plan.md",
			"src/a.test.ts",
		]);
		const hub = hotspots.files.find((file) => file.path === "src/hub.ts");
		expect(hub).toMatchObject({ edits: 3, failed: 1, changedSessions: 3, workspaceId: "w1" });
		expect(hub?.sessions).toEqual([2, 3, 4]);
		const big = hotspots.files.find((file) => file.path === "src/big.ts");
		expect(big).toMatchObject({ rework: 10, reworkSession: 4, reworkSessions: 1, added: 20 });
		expect(big?.touches).toEqual({ value: 10, origin: "counted" });
		expect(hotspots.outside).toBe(1);
		expect(hotspots.nodeModules).toBe(1);
		expect(hotspots.totalFiles).toBe(9);
		expect(hotspots.actions.split).toBe(1);
		const src = hotspots.dirs.find((dir) => dir.projectId === "p1" && dir.path === "src");
		expect(src).toMatchObject({ files: 4, edits: 24, rework: 3 });
		const rootDir = hotspots.dirs.find((dir) => dir.projectId === "p1" && dir.path === "");
		expect(rootDir?.files).toBe(8);
	});

	test("sorts by changes or sessions on request", async () => {
		const { input } = await corpus();
		const bySessions = await buildStatsHotspots(input, READY, {
			scope: { kind: "all" },
			sort: "sessions",
		});
		expect(bySessions.hotspots.files[0]?.path).toBe("README.md");
		const byChanges = await buildStatsHotspots(input, READY, {
			scope: { kind: "all" },
			sort: "changes",
		});
		expect(byChanges.hotspots.files[0]?.path).toBe("src/big.ts");
	});
});
