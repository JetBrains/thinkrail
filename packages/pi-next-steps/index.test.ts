import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import factory from "./index.ts";

interface ToolResult {
	content: Array<{ type: string; text: string }>;
	details: { items: Array<{ label: string; prompt: string }> };
	terminate?: boolean;
}

interface CapturedTool {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	execute: (toolCallId: string, params: unknown) => Promise<ToolResult>;
}

interface Loaded {
	tool: CapturedTool;
	settle: (ctx: ExtensionContext) => void;
	command: {
		name: string;
		description?: string;
		handler: (args: string, ctx: never) => Promise<void>;
	};
	sent: Array<{ text: string; deliverAs: string | undefined }>;
}

function load(): Loaded {
	let tool: CapturedTool | undefined;
	let settled: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
	let command: Loaded["command"] | undefined;
	const sent: Loaded["sent"] = [];
	const pi = {
		registerTool: (def: CapturedTool) => {
			tool = def;
		},
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
			if (event === "agent_settled") settled = handler;
		},
		registerCommand: (name: string, options: Omit<Loaded["command"], "name">) => {
			command = { name, ...options };
		},
		sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => {
			sent.push({ text: content, deliverAs: options?.deliverAs });
		},
	};
	factory(pi as unknown as ExtensionAPI);
	if (!tool || !settled || !command) throw new Error("factory did not register its full surface");
	const handler = settled;
	return { tool, settle: (ctx) => handler({ type: "agent_settled" }, ctx), command, sent };
}

interface FakeCtx {
	ctx: ExtensionContext;
	selects: Array<{ title: string; options: string[] }>;
	notifications: Array<{ message: string; type: string | undefined }>;
}

function fakeCtx(opts: {
	mode?: string;
	entries?: SessionEntry[];
	idle?: boolean;
	pick?: string;
}): FakeCtx {
	const selects: FakeCtx["selects"] = [];
	const notifications: FakeCtx["notifications"] = [];
	const ctx = {
		mode: opts.mode ?? "tui",
		hasUI: true,
		isIdle: () => opts.idle ?? true,
		sessionManager: { getBranch: () => opts.entries ?? [] },
		ui: {
			select: async (title: string, options: string[]) => {
				selects.push({ title, options });
				return opts.pick;
			},
			notify: (message: string, type?: string) => {
				notifications.push({ message, type });
			},
		},
	};
	return { ctx: ctx as unknown as ExtensionContext, selects, notifications };
}

const OFFER = [
	{ label: "Run tests", prompt: "Run the e2e suite." },
	{ label: "Open a PR", prompt: "Open a PR for this branch." },
];

async function offeredBranch(loaded: Loaded): Promise<SessionEntry[]> {
	const result = await loaded.tool.execute("call-1", { items: OFFER });
	return [
		{
			id: "e1",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: loaded.tool.name,
				content: result.content,
				details: result.details,
				isError: false,
				timestamp: 1,
			},
		} as unknown as SessionEntry,
	];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("offer_next_steps tool", () => {
	test("registers the tool under its cross-host name", () => {
		expect(load().tool.name).toBe("offer_next_steps");
	});

	test("execute returns normalized details, a numbered fallback, and terminates the turn", async () => {
		const result = await load().tool.execute("call-1", {
			items: [{ label: "  Run tests  ", prompt: " Run the e2e suite. " }],
		});
		expect(result.details).toEqual({
			items: [{ label: "Run tests", prompt: "Run the e2e suite." }],
		});
		expect(result.content[0]?.text).toContain("1. Run tests — Run the e2e suite.");
		expect(result.terminate).toBe(true);
	});

	test("execute rejects an invalid call so the model sees the reason", async () => {
		await expect(load().tool.execute("call-1", { items: [] })).rejects.toThrow(
			/offer_next_steps: .*at least one suggestion/,
		);
	});

	test("prompt metadata pins the five rules the tool depends on", () => {
		const tool = load().tool;
		const guidelines = tool.promptGuidelines ?? [];
		const text = guidelines.join("\n");
		expect(guidelines.every((line) => line.includes("offer_next_steps"))).toBe(true);
		expect(text).toMatch(/explicitly asks for follow-up actions/);
		expect(text).toMatch(/MUST call offer_next_steps/);
		expect(text).toMatch(/instead of listing or duplicating them in prose/);
		expect(text).toMatch(/final action of a turn/);
		expect(text).toMatch(/no further assistant response/);
		expect(text).toMatch(/Omit offer_next_steps entirely/);
		expect(text).toMatch(/in place of ask_user_question/);
		expect(tool.description).toMatch(/MUST use offer_next_steps/);
		expect(tool.promptSnippet).toMatch(/MUST use offer_next_steps/);
	});
});

describe("native selector after settlement", () => {
	test("opens the selector with the offered labels and sends the chosen prompt immediately", async () => {
		const loaded = load();
		const entries = await offeredBranch(loaded);
		const { ctx, selects } = fakeCtx({ entries, pick: "Open a PR" });
		loaded.settle(ctx);
		await flush();
		expect(selects).toEqual([{ title: "Next steps", options: ["Run tests", "Open a PR"] }]);
		expect(loaded.sent).toEqual([{ text: "Open a PR for this branch.", deliverAs: undefined }]);
	});

	test("Escape cancels without consuming the offer", async () => {
		const loaded = load();
		const entries = await offeredBranch(loaded);
		const first = fakeCtx({ entries });
		loaded.settle(first.ctx);
		await flush();
		expect(first.selects).toHaveLength(1);
		expect(loaded.sent).toEqual([]);

		const second = fakeCtx({ entries, pick: "Run tests" });
		loaded.settle(second.ctx);
		await flush();
		expect(loaded.sent).toEqual([{ text: "Run the e2e suite.", deliverAs: undefined }]);
	});

	test("a stale offer never opens the selector", async () => {
		const loaded = load();
		const entries = await offeredBranch(loaded);
		entries.push({
			id: "e2",
			parentId: "e1",
			timestamp: "2026-01-01T00:00:01.000Z",
			type: "message",
			message: { role: "user", content: "something else", timestamp: 2 },
		} as unknown as SessionEntry);
		const { ctx, selects } = fakeCtx({ entries, pick: "Run tests" });
		loaded.settle(ctx);
		await flush();
		expect(selects).toEqual([]);
		expect(loaded.sent).toEqual([]);
	});

	test("delivers as a follow-up when another extension already started work", async () => {
		const loaded = load();
		const entries = await offeredBranch(loaded);
		const { ctx } = fakeCtx({ entries, pick: "Run tests", idle: false });
		loaded.settle(ctx);
		await flush();
		expect(loaded.sent).toEqual([{ text: "Run the e2e suite.", deliverAs: "followUp" }]);
	});

	test("non-TUI modes keep the durable fallback only — no selector, no send", async () => {
		for (const mode of ["rpc", "json", "print"]) {
			const loaded = load();
			const entries = await offeredBranch(loaded);
			const { ctx, selects } = fakeCtx({ entries, mode, pick: "Run tests" });
			loaded.settle(ctx);
			await flush();
			expect(selects).toEqual([]);
			expect(loaded.sent).toEqual([]);
		}
	});
});

describe("/next-steps", () => {
	test("reopens the still-current offer — including a branch rebuilt after a resume", async () => {
		const loaded = load();
		const entries = await offeredBranch(loaded);
		entries.unshift({
			id: "e0",
			parentId: null,
			timestamp: "2025-12-31T00:00:00.000Z",
			type: "message",
			message: { role: "user", content: "earlier request", timestamp: 0 },
		} as unknown as SessionEntry);
		const { ctx, selects } = fakeCtx({ entries, pick: "Run tests" });
		await loaded.command.handler("", ctx as never);
		expect(selects).toHaveLength(1);
		expect(loaded.sent).toEqual([{ text: "Run the e2e suite.", deliverAs: undefined }]);
	});

	test("says so when nothing is on offer", async () => {
		const loaded = load();
		const { ctx, notifications, selects } = fakeCtx({ entries: [] });
		await loaded.command.handler("", ctx as never);
		expect(selects).toEqual([]);
		expect(notifications).toEqual([{ message: "No next steps on offer right now.", type: "info" }]);
	});

	test("is named /next-steps and reports that it needs interactive mode elsewhere", async () => {
		const loaded = load();
		expect(loaded.command.name).toBe("next-steps");
		const entries = await offeredBranch(loaded);
		const { ctx, notifications } = fakeCtx({ entries, mode: "rpc" });
		await loaded.command.handler("", ctx as never);
		expect(notifications).toEqual([
			{ message: "/next-steps needs pi's interactive mode.", type: "warning" },
		]);
	});
});
