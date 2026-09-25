import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage, PiEvent, SessionStats } from "@thinkrail/contracts";
import type { SessionRef } from "@thinkrail/ext";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const SESSION: SessionRef = {
	sessionId: "s1",
	workspaceId: "w1",
	title: "Chat",
	isStreaming: true,
};
const STATS: SessionStats = {
	sessionId: "s1",
	totalMessages: 4,
	tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, total: 1500 },
	cost: 0.42,
	contextUsage: { tokens: 38_000, contextWindow: 100_000, percent: 38 },
};

interface SpanView {
	id: string;
	kind: string;
	name: string;
	status: string;
	parentId?: string;
	label?: string;
	preview?: string;
	costUsd?: number;
	end?: number;
}

interface TimelineView {
	live: boolean;
	run: number;
	dropped: number;
	spans: SpanView[];
}

const assistant = (text: string, cost: number): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "faux",
	provider: "faux",
	model: "faux-model",
	usage: {
		input: 1000,
		output: 200,
		cacheRead: 50,
		cacheWrite: 0,
		totalTokens: 1250,
		cost: { input: cost / 2, output: cost / 2, cacheRead: 0, cacheWrite: 0, total: cost },
	},
	stopReason: "stop",
	timestamp: Date.now(),
});

const toolText = (text: string) => ({ content: [{ type: "text", text }] });

let base: string;
let sessions: SessionRef[];

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "timeline-ext-"));
	sessions = [SESSION];
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const makeHost = () =>
	createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: {
			list: () => sessions,
			get: (id) => sessions.find((session) => session.sessionId === id),
			stats: (id) => {
				if (id !== "s1") throw new Error(`session ${id} not live`);
				return STATS;
			},
		},
	});

type Host = ReturnType<typeof makeHost>;

const load = async () => {
	const host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get("timeline")).toMatchObject({ status: "active" });
	return host;
};

const feed = (host: Host, ...events: PiEvent[]) => {
	for (const event of events) host.observe({ sessionId: "s1", event });
};

const read = <T>(host: Host, key: string) => host.snapshot([key])[key] as T | undefined;

const until = async (check: () => boolean) => {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

const timelineOf = (host: Host) => read<TimelineView>(host, "timeline:s1");
const spanOf = (host: Host, id: string) => timelineOf(host)?.spans.find((span) => span.id === id);

const previewOf = async (host: Host, spanId: string) => {
	const result = await host.invokeAction({
		ext: "timeline",
		id: "preview",
		payload: { spanId },
		ctx: { sessionId: "s1" },
	});
	return (result as { preview?: string }).preview;
};

const startRun = (host: Host) =>
	feed(
		host,
		{ type: "agent_start" },
		{ type: "turn_start" },
		{ type: "message_end", message: assistant("Listing files", 0.03) },
		{
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls -la" },
		},
		{
			type: "tool_execution_update",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls -la" },
			partialResult: toolText("first"),
		},
		{
			type: "tool_execution_update",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "ls -la" },
			partialResult: toolText("second"),
		},
	);

const finishRun = (host: Host) =>
	feed(
		host,
		{
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "bash",
			result: toolText("done"),
			isError: false,
		},
		{ type: "turn_end", message: assistant("Listing files", 0.03), toolResults: [] },
		{ type: "compaction_start", reason: "threshold" },
		{
			type: "compaction_end",
			reason: "threshold",
			result: { tokensBefore: 148_000 },
			aborted: false,
			willRetry: false,
		},
		{ type: "agent_end", messages: [], willRetry: false },
	);

describe("timeline example extension", () => {
	test("validates through the host's dry-load path", async () => {
		const host = makeHost();
		await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
		const result = await host.validate("timeline");
		expect(result).toMatchObject({ ok: true });
		if (result.ok)
			expect(result.surfaces.map((surface) => surface.id)).toEqual(["timeline", "cost"]);
		await host.dispose();
	});

	test("turns pi events into live turn and tool spans, closed only at agent_settled", async () => {
		const host = await load();
		startRun(host);
		await until(() => spanOf(host, "call-1") !== undefined);
		expect(await previewOf(host, "call-1")).toBe("second");
		expect(spanOf(host, "call-1")?.preview).toBeUndefined();
		expect(timelineOf(host)).toMatchObject({ live: true, run: 1 });
		expect(spanOf(host, "r1t1")).toMatchObject({
			kind: "turn",
			status: "running",
			costUsd: 0.03,
			label: "faux-model",
		});
		expect(spanOf(host, "call-1")).toMatchObject({
			kind: "tool",
			name: "bash",
			label: "ls -la",
			parentId: "r1t1",
			status: "running",
		});

		finishRun(host);
		await until(() => spanOf(host, "r1c1")?.status === "ok");
		expect(timelineOf(host)?.live).toBe(true);
		expect(spanOf(host, "call-1")?.status).toBe("ok");
		expect(await previewOf(host, "call-1")).toBe("done");
		expect(spanOf(host, "r1c1")?.label).toBe("threshold · 148000 tokens before");

		feed(host, { type: "agent_settled", terminal: { stopReason: "stop" } });
		expect(timelineOf(host)?.live).toBe(false);
		await until(() => read(host, "timeline:cost:s1") !== undefined);
		expect(read<SessionStats>(host, "timeline:cost:s1")).toEqual(STATS);
		await host.dispose();
	});

	test("a settled run survives a host restart and republishes on watch", async () => {
		const first = await load();
		startRun(first);
		finishRun(first);
		feed(first, { type: "agent_settled", terminal: { stopReason: "stop" } });
		const storeFile = join(base, "store", "timeline.json");
		await until(
			() => existsSync(storeFile) && readFileSync(storeFile, "utf8").includes('"sessions"'),
		);
		await first.dispose();

		sessions = [];
		const second = await load();
		expect(timelineOf(second)).toBeUndefined();
		sessions = [SESSION];
		await second.invokeAction({
			ext: "timeline",
			id: "watch",
			payload: undefined,
			ctx: { sessionId: "s1" },
		});
		expect(timelineOf(second)?.spans.map((span) => span.id)).toEqual(["r1t1", "call-1", "r1c1"]);
		await until(() => read(second, "timeline:cost:s1") !== undefined);

		startRun(second);
		await until(() => timelineOf(second)?.run === 2);
		expect(spanOf(second, "r2t1")?.status).toBe("running");
		await second.dispose();
	});

	test("a run already in flight at load leaves the saved turns untouched", async () => {
		const first = await load();
		startRun(first);
		finishRun(first);
		feed(first, { type: "agent_settled", terminal: { stopReason: "stop" } });
		const storeFile = join(base, "store", "timeline.json");
		await until(
			() => existsSync(storeFile) && readFileSync(storeFile, "utf8").includes('"sessions"'),
		);
		await first.dispose();

		const second = await load();
		const saved = spanOf(second, "r1t1");
		const savedCompaction = spanOf(second, "r1c1");
		feed(
			second,
			{ type: "message_end", message: assistant("late", 9.9) },
			{ type: "turn_end", message: assistant("late", 9.9), toolResults: [] },
			{
				type: "compaction_end",
				reason: "overflow",
				result: { tokensBefore: 1 },
				aborted: true,
				willRetry: false,
			},
			{ type: "agent_settled", terminal: { stopReason: "stop" } },
		);
		expect(spanOf(second, "r1t1")).toEqual(saved);
		expect(spanOf(second, "r1c1")).toEqual(savedCompaction);
		await second.dispose();

		const third = await load();
		expect(spanOf(third, "r1t1")).toEqual(saved);
		await third.dispose();
	});

	test("caps spans per session even inside one long turn", async () => {
		const host = await load();
		feed(host, { type: "agent_start" }, { type: "turn_start" });
		for (let index = 0; index < 450; index++)
			feed(
				host,
				{ type: "tool_execution_start", toolCallId: `t${index}`, toolName: "read", args: {} },
				{
					type: "tool_execution_end",
					toolCallId: `t${index}`,
					toolName: "read",
					result: toolText("ok"),
					isError: false,
				},
			);
		feed(host, { type: "agent_settled", terminal: null });
		const timeline = timelineOf(host);
		expect(timeline?.spans.length).toBeLessThanOrEqual(400);
		expect(timeline?.dropped).toBeGreaterThan(0);
		expect(timeline?.spans.at(-1)?.id).toBe("t449");
		await host.dispose();
	});
});
