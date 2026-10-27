import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	childFileUsage,
	reconcileSubagentUsage,
	SUBAGENT_USAGE_KIND,
	type SubagentUsage,
	unrecordedUsage,
} from "./subagentUsage";

const header = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({ type: "session", version: 3, id: "child", timestamp: "", cwd: "/w", ...extra });

const assistant = (input: number, cost: number) =>
	JSON.stringify({
		type: "message",
		id: `a${input}`,
		parentId: null,
		timestamp: "",
		message: {
			role: "assistant",
			content: [],
			provider: "anthropic",
			model: "claude",
			usage: {
				input,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: input + 1,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
			},
			stopReason: "stop",
			timestamp: 0,
		},
	});

test("childFileUsage totals a fresh child and ignores a line torn by a crash", () => {
	const content = [header(), assistant(10, 0.1), assistant(20, 0.2), '{"type":"mess'].join("\n");
	expect(childFileUsage("child", content)).toMatchObject({
		provider: "anthropic",
		model: "claude",
		usage: { input: 30, output: 2, totalTokens: 32, cost: { total: 0.30000000000000004 } },
	});
});

test("childFileUsage skips forked children whose copied history carries the parent's spend", () => {
	const content = [header({ parentSession: "/p.jsonl" }), assistant(10, 0.1)].join("\n");
	expect(childFileUsage("child", content)).toBeUndefined();
});

const usageOf = (input: number, cost: number) => ({
	input,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: input + 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

test("unrecordedUsage appends a non-negative shortfall, cost-only included, but not cost noise", () => {
	const total = childFileUsage("child", [header(), assistant(30, 0.3)].join("\n"));
	if (!total) throw new Error("expected usage");
	const recorded = (input: number, cost: number) => ({
		input,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		cost,
	});
	expect(unrecordedUsage(total, undefined)?.usage.input).toBe(30);
	expect(unrecordedUsage(total, recorded(10, 0.1))?.usage).toMatchObject({
		input: 20,
		output: 0,
		cost: { total: 0.19999999999999998 },
	});
	expect(unrecordedUsage(total, recorded(30, 0.3 - 1e-12))).toBeUndefined();
	const costOnly = unrecordedUsage(total, recorded(30, 0.25));
	expect(costOnly?.usage).toMatchObject({ input: 0, output: 0, totalTokens: 0 });
	expect(costOnly?.usage.cost.total).toBeCloseTo(0.05, 12);
	expect(unrecordedUsage(total, recorded(40, 0.4))).toBeUndefined();
});

function childDir(...lines: string[]): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "trusage-"));
	const file = join(dir, "2026-01-01T00-00-00-000Z_child.jsonl");
	writeFileSync(file, [header(), ...lines].join("\n"));
	return { dir, file };
}

function parentRecords(dir: string) {
	const entries: SessionEntry[] = [];
	const record = (
		{ provider, model, usage, childSessionId }: SubagentUsage,
		timestamp = new Date(0).toISOString(),
	) => {
		entries.push({
			type: "usage",
			id: `u${entries.length}`,
			parentId: null,
			timestamp,
			kind: SUBAGENT_USAGE_KIND,
			provider,
			model,
			usage,
			note: childSessionId,
		});
	};
	const reconcile = () =>
		reconcileSubagentUsage({
			dir,
			entries: () => entries,
			isLive: () => false,
			record: (usage) => record(usage),
		});
	const inputs = () => entries.map((entry) => entry.type === "usage" && entry.usage.input);
	return { entries, record, reconcile, inputs };
}

test("reconcileSubagentUsage is idempotent and records a child file again once it grows", async () => {
	const { dir, file } = childDir(assistant(10, 0.1));
	const parent = parentRecords(dir);
	await parent.reconcile();
	await parent.reconcile();
	await parent.reconcile();
	expect(parent.inputs()).toEqual([10]);

	appendFileSync(file, `\n${assistant(20, 0.2)}`);
	await parent.reconcile();
	expect(parent.inputs()).toEqual([10, 20]);
});

test("a lost earlier record is recovered even when a later record of that child survives", async () => {
	const { dir } = childDir(assistant(10, 0.1), assistant(20, 0.2));
	const parent = parentRecords(dir);
	const later = new Date(Date.now() + 60_000).toISOString();
	parent.record(
		{ childSessionId: "child", provider: "anthropic", model: "claude", usage: usageOf(20, 0.2) },
		later,
	);
	await parent.reconcile();
	expect(parent.inputs()).toEqual([20, 10]);
});

test("an unchanged child file is compared with the parent's current records every time", async () => {
	const { dir } = childDir(assistant(10, 0.1));
	const parent = parentRecords(dir);
	await parent.reconcile();
	await parent.reconcile();
	parent.entries.length = 0;
	await parent.reconcile();
	expect(parent.inputs()).toEqual([10]);
});

test("cost-only child spend is reconciled once", async () => {
	const { dir } = childDir(
		JSON.stringify({
			type: "usage",
			id: "warm",
			parentId: null,
			timestamp: "",
			kind: "cache_warm",
			provider: "anthropic",
			model: "claude",
			usage: { ...usageOf(0, 0.5), output: 0, totalTokens: 0 },
		}),
	);
	const parent = parentRecords(dir);
	await parent.reconcile();
	await parent.reconcile();
	expect(parent.entries.map((entry) => entry.type === "usage" && entry.usage.cost.total)).toEqual([
		0.5,
	]);
});
