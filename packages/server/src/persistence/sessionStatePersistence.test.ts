import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		version: 1,
		completionBySession: {
			s1: {
				runId: "run-1",
				completion: { completionId: "completion-1", outcome: "failed", failure: "length" },
			},
		},
		cancelledRunBySession: { s2: "run-2" },
	});
	expect(loadSessionReceipts()).toEqual({
		version: 1,
		baselineComplete: true,
		handledCompletionBySession: { s1: "completion-1" },
	});
});

test("malformed receipt metadata fails loudly instead of resetting owner-global attention", () => {
	const root = process.env.THINKRAIL_DATA_DIR;
	if (!root) throw new Error("missing fixture data dir");
	writeFileSync(
		join(root, "session-receipts.json"),
		JSON.stringify({ version: 1, baselineComplete: true, handledCompletionBySession: { s1: 42 } }),
	);
	expect(() => loadSessionReceipts()).toThrow("Invalid session receipts");
});
