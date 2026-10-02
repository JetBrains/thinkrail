import { afterAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadSessionLifecycle,
	loadSessionReceipts,
	saveSessionLifecycle,
	saveSessionReceipts,
} from "./persistence";

const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const roots: string[] = [];

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-session-state-"));
	roots.push(root);
	process.env.THINKRAIL_DATA_DIR = root;
});

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function dataRoot(): string {
	const root = process.env.THINKRAIL_DATA_DIR;
	if (!root) throw new Error("missing fixture data dir");
	return root;
}

test("session lifecycle and receipts round-trip exact ids", () => {
	saveSessionLifecycle({
		version: 1,
		completionBySession: {
			s1: {
				runId: "run-1",
				completion: { completionId: "completion-1", outcome: "failed", failure: "length" },
			},
		},
		cancelledRunBySession: { s2: "run-2" },
	});
	saveSessionReceipts({
		version: 1,
		baselineComplete: true,
		handledCompletionBySession: { s1: "completion-1" },
	});
	expect(loadSessionLifecycle()).toEqual({
		kind: "loaded",
		value: {
			version: 1,
			completionBySession: {
				s1: {
					runId: "run-1",
					completion: { completionId: "completion-1", outcome: "failed", failure: "length" },
				},
			},
			cancelledRunBySession: { s2: "run-2" },
		},
	});
	expect(loadSessionReceipts()).toEqual({
		kind: "loaded",
		value: {
			version: 1,
			baselineComplete: true,
			handledCompletionBySession: { s1: "completion-1" },
		},
	});
});

test("absent session metadata loads as missing", () => {
	expect(loadSessionLifecycle()).toEqual({ kind: "missing" });
	expect(loadSessionReceipts()).toEqual({ kind: "missing" });
});

const unreadable = [
	{ file: "session-receipts.json", load: loadSessionReceipts, bytes: "" },
	{
		file: "session-receipts.json",
		load: loadSessionReceipts,
		bytes: JSON.stringify({
			version: 1,
			baselineComplete: true,
			handledCompletionBySession: { s1: 42 },
		}),
	},
	{ file: "session-lifecycle.json", load: loadSessionLifecycle, bytes: '{"version":1,"complet' },
	{ file: "session-lifecycle.json", load: loadSessionLifecycle, bytes: "null" },
	{
		file: "session-lifecycle.json",
		load: loadSessionLifecycle,
		bytes: JSON.stringify({
			version: 1,
			completionBySession: { s1: { runId: "run-1", completion: 5 } },
			cancelledRunBySession: {},
		}),
	},
];

for (const [index, { file, load, bytes }] of unreadable.entries()) {
	test(`unreadable ${file} #${index} is set aside with its original bytes`, () => {
		const path = join(dataRoot(), file);
		writeFileSync(path, bytes);

		const result = load();

		expect(result.kind).toBe("set-aside");
		if (result.kind !== "set-aside") return;
		expect(result.file).toBe(file);
		expect(result.setAsidePath).toStartWith(`${path}.corrupt-`);
		expect(readFileSync(result.setAsidePath ?? "", "utf8")).toBe(bytes);
		expect(existsSync(path)).toBe(false);
		expect(load()).toEqual({ kind: "missing" });
		expect(readdirSync(dataRoot())).toHaveLength(1);
	});
}
