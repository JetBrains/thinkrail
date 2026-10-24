import { expect, test } from "bun:test";
import { childFileUsage, unrecordedUsage } from "./subagentUsage";

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

test("unrecordedUsage appends only a non-negative token shortfall", () => {
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
	expect(unrecordedUsage(total, recorded(30, 0.29999999))).toBeUndefined();
	expect(unrecordedUsage(total, recorded(40, 0.4))).toBeUndefined();
});
