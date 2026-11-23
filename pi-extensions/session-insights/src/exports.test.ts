import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { link, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import {
	CONTAINED_PIN,
	CONTAINED_SECRET_CALLS,
	CONTAINED_SECRETS,
	SECRET_ARGS,
	SECRET_CALLS,
	sessionOf,
} from "../test/calls.ts";
import { diagnostics, keyLeaks, rsa4096Key } from "../test/pem.ts";
import { LARGE_TEST_MS, withinBudget } from "../test/perf.ts";
import { buildSessionAnalysis } from "./analysis.ts";
import { type ChromeTraceEvent, chromeTrace } from "./chromeTrace.ts";
import { EXPORT_RULES, type SessionOverview } from "./core.ts";
import { networkReferences, renderSessionHtml } from "./exportHtml.ts";
import {
	checkExport,
	chromeTraceOutput,
	type ExportOutput,
	exportBaseName,
	fixtureOutput,
	parseExportFixtureParams,
	parseExportParams,
	publishFile,
	publishFolder,
	receiptForTurn,
	sourceCredentials,
	type TreeFile,
	writeExport,
} from "./exports.ts";
import { cutSessionFile, fixtureName, fixturePath } from "./fixture.ts";
import { buildSessionSummary } from "./list.ts";
import { createRedactor } from "./redact.ts";
import { SessionIndex } from "./sessionIndex.ts";
import { buildSessionTimeline } from "./timeline.ts";
import type { BuiltTrace } from "./trace.ts";
import { TraceStore } from "./traceStore.ts";
import { buildSessionSubagents, SubagentActivityCache } from "./waves.ts";

const root = tempDir("exports");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HOME = "/home/alice";
const T0 = Date.parse("2026-11-01T10:00:00.000Z");
const CHILD = "019f0000-0000-7000-8000-00000000c0de";

/** Secrets planted across prompts, arguments, results, replies and thinking, each with the text that must not survive. */
const CORPUS = {
	anthropic: ["sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAAAA"],
	github: ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", "ghp_ABCDEFGHIJ"],
	aws: ["AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
	slack: ["xoxb-1234567890-abcdefghij", "xoxb-1234567890"],
	bearer: ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz"],
	assignment: ["export API_KEY=supersecretvalue123", "supersecretvalue123"],
	json: ['{"apiKey": "jsonsecretvalue"}', "jsonsecretvalue"],
	url: ["https://user:hunter2@example.com/x", "hunter2"],
	key: ["-----BEGIN RSA PRIVATE KEY-----\nMIIabcdef\n-----END RSA PRIVATE KEY-----", "MIIabcdef"],
	email: ["alice@example.com", "alice@example.com"],
	jwt: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", "eyJhbGciOiJIUzI1NiJ9"],
	home: ["/home/alice/repo/src/a.ts", "/home/alice"],
	otherHome: ["/Users/bob/secret.txt", "/Users/bob"],
	ansi: ["\u001b[31mred\u001b[0m", "\u001b["],
} as const;

interface Built {
	file: string;
	builder: TranscriptBuilder;
	ids: Record<string, string>;
}

function session(name: string): Built {
	const builder = new TranscriptBuilder({ id: `export-${name}`, cwd: `${HOME}/repo`, start: T0 });
	const ids: Record<string, string> = {};
	ids.prompt1 = builder.user(
		`Fix it. My key is ${CORPUS.anthropic[0]}, mail me at ${CORPUS.email[0]}. ${CORPUS.jwt[0]}`,
	);
	ids.call1 = builder.assistant({
		text: `Looking at ${CORPUS.url[0]}`,
		thinking: [{ thinking: `Check ${CORPUS.otherHome[0]} and ${CORPUS.slack[0]}` }],
		toolCalls: [
			{
				id: "c-bash",
				name: "bash",
				arguments: { command: `${CORPUS.assignment[0]} && git push ${CORPUS.github[0]}` },
			},
			{ id: "c-read", name: "read", arguments: { path: CORPUS.home[0] } },
			{
				id: "c-agent",
				name: "Agent",
				arguments: { subagent_type: "scout", task: "Find the docs" },
			},
		],
		usage: usage(100, 0.25),
	});
	ids.bash = builder.toolResult({
		toolCallId: "c-bash",
		toolName: "bash",
		text: `${CORPUS.ansi[0]} ${CORPUS.bearer[0]} ${CORPUS.aws[0]}`,
		isError: true,
	});
	ids.read = builder.toolResult({
		toolCallId: "c-read",
		toolName: "read",
		text: `${CORPUS.json[0]}\n${CORPUS.key[0]}`,
	});
	ids.agent = builder.toolResult({
		toolCallId: "c-agent",
		toolName: "Agent",
		details: runDetails(CHILD, "completed", { tokens: 5, cost: 0.05 }),
		text: "Docs are in docs/",
	});
	ids.reply1 = builder.assistant({ text: "Done with turn one.", usage: usage(50, 0.1) });
	ids.abandoned = builder.user("An abandoned prompt");
	builder.assistant({ text: "Abandoned reply" });
	builder.branchFrom(ids.reply1);
	ids.prompt2 = builder.user("Now the second turn");
	ids.reply2 = builder.assistant({ text: "Second reply", usage: usage(20, 0.05) });
	return { file: writeSession(root, name, builder), builder, ids };
}

function traces(): TraceStore {
	return new TraceStore({ redactor: createRedactor(HOME), sliceMs: 1000 });
}

async function traceOf(built: Built, store = traces()): Promise<BuiltTrace> {
	const trace = await store.trace(built.file);
	if (!trace) throw new Error("expected a trace");
	return trace;
}

async function htmlOf(built: Built, signal?: AbortSignal): Promise<string> {
	const store = traces();
	const trace = await traceOf(built, store);
	const index = new SessionIndex({
		sessionFiles: async () => [built.file],
		childTranscriptDirs: async () => [],
	});
	const state = await index.ensureFresh(10_000);
	const summary = await buildSessionSummary(
		{
			index,
			projects: [{ id: "p1", name: "Alpha", kind: "repository" }],
			place: () => ({
				projectId: "p1",
				workspaceId: "w1",
				workspaceName: "main",
				workspace: "open",
			}),
			status: () => ({ live: false, outcome: "succeeded" }),
		},
		state,
		trace.sessionId,
	);
	const overview = summary.session as SessionOverview;
	return renderSessionHtml({
		overview,
		trace,
		store,
		timeline: await buildSessionTimeline(trace),
		analysis: buildSessionAnalysis(trace, []),
		subagents: await buildSessionSubagents({
			trace,
			file: built.file,
			store,
			transcripts: new Map(),
			removed: false,
			activity: new SubagentActivityCache(),
		}),
		labels: { labels: ["good", "flaky tests"], note: `Reviewed by ${CORPUS.email[0]}` },
		sliceMs: 1000,
		...(signal ? { signal } : {}),
	});
}

function target(name: string) {
	const dir = join(root, `artifacts-${name}`);
	return { dir, relative: ".thinkrail/context/" };
}

describe("the HTML export", () => {
	const built = session("html");

	test("is deterministic, self-contained and masks the corpus", async () => {
		const first = await htmlOf(built);
		const second = await htmlOf(built);
		expect(second).toBe(first);
		expect(networkReferences(first)).toEqual([]);
		expect(first).not.toMatch(/\b(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i);
		expect(first).toContain("default-src 'none'");
		for (const [, survivor] of Object.values(CORPUS)) expect(first).not.toContain(survivor);
		expect(first).toContain("[redacted]");
		expect(checkExport([{ path: "", content: first, check: "html" }], HOME)).toEqual([]);
	});

	test("carries the header figures with provenance, every turn, the full trace and the summaries", async () => {
		const html = await htmlOf(built);
		expect(html).toContain("<h1>“Fix it.");
		expect(html).toContain("Alpha › main");
		expect(html).toMatch(/title="recorded by pi[^"]*from message\[assistant\]\.usage/);
		expect(html).toContain('<section id="turns">');
		expect(html.match(/<details id="ev-\d+" class="event turn/g)?.length).toBe(2);
		expect(html).toContain("Expand all");
		expect(html).toContain("1 entries on abandoned branches are not shown.".replace("1", "2"));
		expect(html).toContain('<section id="errors">');
		expect(html).toContain("changedApproach");
		expect(html).toContain('<section id="subagents">');
		expect(html).toContain("Find the docs");
		expect(html).toContain('<span class="chip">good</span>');
		expect(html).toContain("Reviewed by [redacted]");
		expect(html).not.toContain("Abandoned reply");
	});
});

describe("the HTML export's check reads text nodes and markup apart", () => {
	const headChars = Math.round(EXPORT_RULES.html.result * 0.7);
	const builder = new TranscriptBuilder({ id: "export-quotes", cwd: `${HOME}/repo`, start: T0 });
	builder.user("Fix the styles and the env");
	builder.assistant({
		toolCalls: [
			{ id: "q1", name: "read", arguments: { path: "src/app.css" } },
			{ id: "q2", name: "read", arguments: { path: ".env.example" } },
			{ id: "q3", name: "read", arguments: { path: "src/App.java" } },
			{ id: "q4", name: "bash", arguments: { command: `${"x".repeat(105)} API_KEY=s3cr3tvalue1` } },
			{ id: "q5", name: "db_connect", arguments: { user: "me", password: "hunter2" } },
		],
		usage: usage(100, 0.25),
	});
	builder.toolResult({
		toolCallId: "q1",
		toolName: "read",
		text: '@import "tailwindcss";\n.a { background: url(https://cdn.example/x.png) }',
	});
	builder.toolResult({ toolCallId: "q2", toolName: "read", text: "PORT=3000\nOPENAI_API_KEY=" });
	builder.toolResult({
		toolCallId: "q3",
		toolName: "read",
		text: '@Import(Config.class)\n<link rel="stylesheet" href="https://x.example/y.css">',
	});
	builder.toolResult({
		toolCallId: "q4",
		toolName: "bash",
		text: `${"x".repeat(headChars - 12)} API_KEY=supersecretvalue ${"y".repeat(EXPORT_RULES.html.result)}`,
	});
	builder.toolResult({ toolCallId: "q5", toolName: "db_connect", text: "connected" });
	builder.assistant({ text: "Done.", usage: usage(50, 0.1) });
	const built = { file: writeSession(root, "quotes", builder), builder, ids: {} };

	test("bodies quoting CSS imports or markup, ending in `KEY=`, or cut inside a mask pass", async () => {
		const page = await htmlOf(built);
		expect(page).toContain("@import &quot;tailwindcss&quot;");
		expect(page).toContain("OPENAI_API_KEY=</pre>");
		expect(page).toContain(" API_KEY=…</span>");
		expect(page).toMatch(/ API_KEY=<span class="cut">/);
		expect(page).not.toContain("hunter2");
		expect(networkReferences(page)).toEqual([]);
		expect(checkExport([{ path: "", content: page, check: "html" }], HOME)).toEqual([]);
	});

	test("markup outside the bodies is still caught", () => {
		const page =
			'<html><head><style>@import url("x.css");</style></head><body><p>ok</p></body></html>';
		expect(networkReferences(page)).toEqual(["import"]);
		expect(networkReferences('<a href="//cdn.example/x">x</a><img src="#ev-1">')).toEqual(["href"]);
		expect(networkReferences('<link rel="icon" href="#">')).toEqual(["link"]);
		expect(
			checkExport([{ path: "", content: `<p title="${HOME}/x">ok</p>`, check: "html" }], HOME),
		).toEqual(["homePath"]);
	});
});

describe("the post-export check", () => {
	test("catches a planted secret in any file kind and writes nothing", async () => {
		const where = target("planted");
		for (const [check, content] of [
			["html", `<p>${CORPUS.anthropic[0]}</p>`],
			["json", JSON.stringify({ note: `mail ${CORPUS.email[0]}` })],
			["jsonl", `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ path: CORPUS.home[0] })}\n`],
			["text", `TOKEN=${"z".repeat(20)}`],
		] as const) {
			const result = await writeExport(
				where,
				{
					kind: "html",
					name: "x.html",
					folder: false,
					files: [{ path: "", content, check }],
					notes: [],
					sources: [],
				},
				{ home: HOME },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe("CHECK_FAILED");
				expect(result.found.length).toBeGreaterThan(0);
				expect(result.detail).not.toContain("sk-ant");
			}
		}
		expect(existsSync(join(where.dir, EXPORT_RULES.folder, "x.html"))).toBe(false);
	});

	test("reads every output path as well as every content: a planted unmasked name writes nothing", async () => {
		const clean = { path: "", content: "<p>ok</p>", check: "html" as const };
		expect(checkExport([clean], HOME, [], "2026-11-01-fix-it-export-f.html")).toEqual([]);
		expect(checkExport([clean], HOME, [], `${CORPUS.email[0]}.html`)).toEqual(["email"]);
		expect(
			checkExport(
				[{ path: "workspace/customers/alice@example.com.json", content: "{}", check: "text" }],
				HOME,
				[],
				"fixtures/f",
			),
		).toEqual(["email"]);
		expect(
			checkExport([clean], HOME, ["pw-0123456789"], "fixtures/pw-0123456789/session.jsonl"),
		).toEqual(["jsonKey"]);
		const where = target("planted-paths");
		const outputs: ExportOutput[] = [
			{
				kind: "html",
				name: `${CORPUS.email[0]}.html`,
				folder: false,
				files: [clean],
				notes: [],
				sources: [],
			},
			{
				kind: "trace",
				name: `${CORPUS.github[0]}.trace.json`,
				folder: false,
				files: [{ path: "", content: "{}", check: "json" }],
				notes: [],
				sources: [],
			},
			{
				kind: "fixture",
				name: "fixtures/planted",
				folder: true,
				files: [
					{ path: "session.jsonl", content: "{}\n", check: "jsonl" },
					{ path: "workspace/customers/alice@example.com.json", content: "{}", check: "text" },
				],
				notes: [],
				sources: [],
			},
		];
		for (const output of outputs) {
			const result = await writeExport(where, output, { home: HOME });
			expect(result).toMatchObject({ ok: false, code: "CHECK_FAILED" });
			if (!result.ok) expect(result.detail).not.toContain("alice");
		}
		expect(existsSync(join(where.dir, EXPORT_RULES.folder))).toBe(false);
	});

	test("flags a network resource reference in a page", () => {
		expect(
			checkExport(
				[{ path: "", content: '<img src="https://cdn.example/x.png">', check: "html" }],
				HOME,
			),
		).toEqual(["networkReference"]);
		expect(
			checkExport(
				[{ path: "", content: "<p>[redacted] API_KEY=[redacted] ~/repo</p>", check: "html" }],
				HOME,
			),
		).toEqual([]);
	});

	test("a JSON or JSONL string under a secret-named key fails unless masked", () => {
		const json = (value: unknown) => [
			{ path: "a.json", content: JSON.stringify(value), check: "json" as const },
		];
		expect(checkExport(json({ args: { password: "hunter2" } }), HOME)).toEqual(["jsonKey"]);
		expect(
			checkExport(
				[{ path: "a.jsonl", content: `${JSON.stringify({ DB_PASSWORD: "x" })}\n`, check: "jsonl" }],
				HOME,
			),
		).toEqual(["jsonKey"]);
		expect(
			checkExport(json({ password: "[redacted]", apiKey: "", tokenizer: "cl100k" }), HOME),
		).toEqual([]);
	});

	test("a clean export lands atomically under a fresh name", async () => {
		const where = target("clean");
		const output = {
			kind: "html" as const,
			name: "a.html",
			folder: false,
			files: [{ path: "", content: "<p>ok</p>", check: "html" as const }],
			notes: [],
			sources: [],
		};
		const first = await writeExport(where, output, { home: HOME });
		const second = await writeExport(where, output, { home: HOME });
		expect(first).toMatchObject({
			ok: true,
			path: ".thinkrail/context/session-insights/a.html",
			files: 1,
			bytes: 9,
		});
		expect(second).toMatchObject({
			ok: true,
			path: ".thinkrail/context/session-insights/a-2.html",
		});
		expect(readdirSync(join(where.dir, EXPORT_RULES.folder)).sort()).toEqual([
			"a-2.html",
			"a.html",
		]);
	});
});

function phases(events: readonly ChromeTraceEvent[], ph: ChromeTraceEvent["ph"]) {
	return events.filter((event) => event.ph === ph);
}

describe("the Chrome trace", () => {
	test("is a valid, sorted trace: threads, parallel calls apart, counters, a spawn flow", async () => {
		const built = session("chrome");
		const trace = await traceOf(built);
		const { traceEvents, displayTimeUnit, otherData } = chromeTrace({
			trace,
			title: "A session",
			children: new Map(),
		});
		expect(displayTimeUnit).toBe("ms");
		expect(otherData.sessionId).toBe(trace.sessionId);
		for (const event of traceEvents) {
			expect(typeof event.name).toBe("string");
			expect(["X", "I", "C", "M", "s", "f"]).toContain(event.ph);
			expect(Number.isInteger(event.ts) && event.ts >= 0).toBe(true);
			expect(event.pid).toBe(1);
			expect(Number.isInteger(event.tid)).toBe(true);
			if (event.ph === "X") expect(event.dur ?? -1).toBeGreaterThanOrEqual(0);
			if (event.ph === "C")
				expect(Object.values(event.args ?? {}).every((v) => typeof v === "number")).toBe(true);
		}
		const firstNonMeta = traceEvents.findIndex((event) => event.ph !== "M");
		expect(traceEvents.slice(firstNonMeta).every((event) => event.ph !== "M")).toBe(true);
		const timed = traceEvents.slice(firstNonMeta);
		for (let i = 1; i < timed.length; i++)
			expect(timed[i]?.ts ?? 0).toBeGreaterThanOrEqual(timed[i - 1]?.ts ?? 0);
		const names = phases(traceEvents, "M").filter((event) => event.name === "thread_name");
		expect(names.map((event) => event.args?.name)).toEqual(
			expect.arrayContaining([
				"turns",
				"model",
				"tools 1",
				"tools 2",
				"tools 3",
				"subagent 1 · scout",
			]),
		);
		const tools = phases(traceEvents, "X").filter((event) => event.cat === "tool");
		expect(new Set(tools.map((event) => event.tid)).size).toBe(3);
		expect(phases(traceEvents, "X").filter((event) => event.cat === "turn")).toHaveLength(2);
		expect(phases(traceEvents, "C").map((event) => event.name)).toEqual(
			expect.arrayContaining(["context", "tokens", "cost"]),
		);
		const start = phases(traceEvents, "s");
		const finish = phases(traceEvents, "f");
		expect(start).toHaveLength(1);
		expect(finish).toHaveLength(1);
		expect(finish[0]?.id).toBe(start[0]?.id);
		expect(finish[0]?.bp).toBe("e");
		const agent = tools.find((event) => event.name === "Agent");
		expect(start[0]?.tid).toBe(agent?.tid);
		expect(finish[0]?.tid).toBeGreaterThanOrEqual(1000);
		const json = chromeTraceOutput(
			{ trace, title: "A session", children: new Map(), base: "b" },
			[],
		);
		expect(json.name).toBe("b.trace.json");
		expect(checkExport(json.files, HOME)).toEqual([]);
	});

	test("puts a subagent transcript's calls beside its run", async () => {
		const child = new TranscriptBuilder({ id: CHILD, cwd: `${HOME}/repo`, start: T0 + 2000 });
		child.user("Find the docs");
		child.assistant({ toolCalls: [{ id: "k1", name: "grep", arguments: { pattern: "docs" } }] });
		child.toolResult({ toolCallId: "k1", toolName: "grep" });
		const childTrace = await traces().trace(writeSession(root, "chrome-child", child));
		const trace = await traceOf(session("chrome-parent"));
		if (!childTrace) throw new Error("expected a child trace");
		const names = chromeTrace({ trace, title: "t", children: new Map([[CHILD, childTrace]]) })
			.traceEvents.filter((event) => event.name === "thread_name")
			.map((event) => event.args?.name);
		expect(names).toEqual(
			expect.arrayContaining(["subagent 1 · scout · model", "subagent 1 · scout · tools 1"]),
		);
	});
});

describe("the fixture export", () => {
	test("a turn's end keeps the active branch up to the next turn, redacted, the folder rewritten", async () => {
		const built = session("fixture-turn");
		const trace = await traceOf(built);
		const cut = await cutSessionFile(trace, { kind: "turn", turn: 1 }, createRedactor(HOME));
		if (!cut) throw new Error("expected a cut");
		const lines = cut.text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines[0]).toMatchObject({ type: "session", cwd: EXPORT_RULES.fixtureCwd });
		expect(lines.slice(1).map((line) => line.id)).toEqual([
			built.ids.prompt1,
			built.ids.call1,
			built.ids.bash,
			built.ids.read,
			built.ids.agent,
			built.ids.reply1,
		]);
		expect(cut.cut).toMatchObject({ turnEnd: true, entryId: built.ids.reply1 });
		expect(cut.cut.turn?.n).toBe(1);
		expect(cut.text).toContain(`${EXPORT_RULES.fixtureCwd}/src/a.ts`);
		for (const [, survivor] of Object.values(CORPUS)) expect(cut.text).not.toContain(survivor);
		expect(cut.text).not.toContain("\\u001b[");
	});

	test("tool arguments and details under secret-named keys are masked whole", async () => {
		const builder = new TranscriptBuilder({ id: "export-keys", cwd: `${HOME}/repo`, start: T0 });
		builder.user("Log in to the database");
		builder.assistant({
			toolCalls: [
				{
					id: "k1",
					name: "db_connect",
					arguments: { user: "me", password: "hunter2", env: { DB_PASSWORD: "pw1" } },
				},
			],
		});
		builder.toolResult({
			toolCallId: "k1",
			toolName: "db_connect",
			details: { session: { apiKey: "abc123", token: "tok456" } },
			text: "connected",
		});
		builder.assistant({ text: "Connected." });
		const file = writeSession(root, "fixture-keys", builder);
		const store = traces();
		const trace = await store.trace(file);
		if (!trace) throw new Error("expected a trace");
		const cut = await cutSessionFile(trace, { kind: "turn", turn: 1 }, createRedactor(HOME));
		for (const survivor of ["hunter2", "pw1", "abc123", "tok456"])
			expect(cut?.text).not.toContain(survivor);
		expect(cut?.text).toContain('"password":"[redacted]"');
		expect(
			checkExport([{ path: "session.jsonl", content: cut?.text ?? "", check: "jsonl" }], HOME),
		).toEqual([]);
		const call = trace.events.find((event) => event.kind === "tool");
		const loaded = await store.event(file, call?.id ?? "");
		expect(JSON.stringify(loaded?.body.input?.value)).toBe(
			'{"user":"me","password":"[redacted]","env":{"DB_PASSWORD":"[redacted]"}}',
		);
		expect(JSON.stringify(loaded?.body.details?.value)).toBe(
			'{"session":{"apiKey":"[redacted]","token":"[redacted]"}}',
		);
	});

	test("keys are rewritten and masked like values: the session's folder and a credential-bearing key", async () => {
		const cwd = "/srv/acme-private/repo";
		const builder = new TranscriptBuilder({ id: "export-key-names", cwd, start: T0 });
		builder.user("Apply the edits");
		builder.assistant({
			toolCalls: [
				{
					id: "n1",
					name: "apply_many",
					arguments: {
						[`${cwd}/src/a.ts`]: "edit",
						"https://deploy:hunter2pass@example.com/x": "fetch",
					},
				},
			],
		});
		builder.toolResult({ toolCallId: "n1", toolName: "apply_many", text: "done" });
		builder.assistant({ text: "Applied." });
		const trace = await traces().trace(writeSession(root, "fixture-key-names", builder));
		if (!trace) throw new Error("expected a trace");
		const cut = await cutSessionFile(trace, { kind: "turn", turn: 1 }, createRedactor(HOME));
		expect(cut?.text).not.toContain("acme-private");
		expect(cut?.text).not.toContain("hunter2pass");
		expect(cut?.text).toContain(`"${EXPORT_RULES.fixtureCwd}/src/a.ts":"edit"`);
		expect(cut?.text).toContain('"https://[redacted]@example.com/x":"fetch"');
	});

	test("the last turn ends at the file's leaf and leaves abandoned branches out; an event cut stops at its result", async () => {
		const built = session("fixture-leaf");
		const trace = await traceOf(built);
		const redactor = createRedactor(HOME);
		const last = await cutSessionFile(trace, { kind: "turn", turn: 2 }, redactor);
		const ids = last?.text
			.trim()
			.split("\n")
			.slice(1)
			.map((line) => JSON.parse(line).id);
		expect(ids).toContain(built.ids.prompt2);
		expect(ids).toContain(built.ids.reply2);
		expect(ids).not.toContain(built.ids.abandoned);
		const bash = trace.events.find((event) => event.kind === "tool" && event.tool === "bash");
		const atEvent = await cutSessionFile(
			trace,
			{ kind: "event", eventId: bash?.id ?? "" },
			redactor,
		);
		expect(
			atEvent?.text
				.trim()
				.split("\n")
				.slice(1)
				.map((line) => JSON.parse(line).id),
		).toEqual([built.ids.prompt1, built.ids.call1, built.ids.bash]);
		expect(atEvent?.cut.turnEnd).toBe(false);
		expect(await cutSessionFile(trace, { kind: "turn", turn: 9 }, redactor)).toBeNull();
		expect(await cutSessionFile(trace, { kind: "event", eventId: "nope" }, redactor)).toBeNull();
	});

	test("writes the harness layout with a masked markdown snapshot from the turn tree", async () => {
		const built = session("fixture-write");
		const trace = await traceOf(built);
		const encoder = new TextEncoder();
		const asked: { t0: number; t1: number }[] = [];
		const tree: TreeFile[] = [
			{ path: "SPEC.md", bytes: encoder.encode("# Spec\n") },
			{ path: "src/a.ts", bytes: encoder.encode(`const key = "${CORPUS.github[0]}";\n`) },
			{ path: "logo.png", bytes: new Uint8Array([137, 80, 0, 1]) },
		];
		const output = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: exportBaseName(trace, "Fix it"),
			snapshot: async (span) => {
				asked.push(span);
				return tree;
			},
			labels: null,
		});
		if (!output) throw new Error("expected an output");
		expect(asked).toHaveLength(1);
		expect(output.name).toBe("fixtures/2026-11-01-fix-it-export-f-turn-1");
		expect(output.notes).toEqual(["snapshot", "binaryOmitted"]);
		expect(output.files.map((file) => file.path)).toEqual([
			"session.jsonl",
			"workspace/SPEC.md.test",
			"workspace/src/a.ts",
			"insights-export.json",
		]);
		const where = target("fixture");
		const result = await writeExport(where, output, { home: HOME });
		expect(result).toMatchObject({
			ok: true,
			kind: "fixture",
			path: ".thinkrail/context/session-insights/fixtures/2026-11-01-fix-it-export-f-turn-1/",
			files: 4,
		});
		const folder = join(
			where.dir,
			EXPORT_RULES.folder,
			"fixtures",
			"2026-11-01-fix-it-export-f-turn-1",
		);
		expect(readFileSync(join(folder, "workspace", "src", "a.ts"), "utf8")).toBe(
			'const key = "[redacted]";\n',
		);
		expect(existsSync(join(folder, "workspace", "SPEC.md"))).toBe(false);
		const provenance = JSON.parse(readFileSync(join(folder, "insights-export.json"), "utf8"));
		expect(provenance).toMatchObject({
			sessionId: trace.sessionId,
			snapshot: "turn tree",
			cut: { kind: "turn", turn: 1 },
		});
		expect(provenance.labels).toBeUndefined();
		expect(provenance.omitted).toBeUndefined();
	});

	/** Where the harness's replay puts a snapshot file: `*.md.test` back to `*.md`, anything else as is. */
	const replayed = (path: string) => path.replace(/\.md\.test$/, ".md");

	async function snapshotFixture(name: string, paths: readonly string[]) {
		const trace = await traceOf(session(name));
		const encoder = new TextEncoder();
		const output = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: name,
			snapshot: async () =>
				paths.map((path) => ({ path, bytes: encoder.encode(`contents of ${path}\n`) })),
			labels: null,
		});
		if (!output) throw new Error("expected an output");
		const workspace = output.files.filter((file) => file.path.startsWith("workspace/"));
		for (const file of workspace)
			expect(file.content).toBe(`contents of ${replayed(file.path.slice("workspace/".length))}\n`);
		const where = target(name);
		const result = await writeExport(where, output, { home: HOME });
		const folder = join(where.dir, EXPORT_RULES.folder, "fixtures", `${name}-turn-1`);
		const provenance = result.ok
			? JSON.parse(readFileSync(join(folder, "insights-export.json"), "utf8"))
			: null;
		return { output, result, folder, provenance, workspace: workspace.map((file) => file.path) };
	}

	test("a file the masking would land on another's name is left out with a note, the cut kept", async () => {
		const { output, result, folder, provenance, workspace } = await snapshotFixture(
			"fixture-clash",
			["README.md", "README.md.test", "src/a.ts", "src/./a.ts"],
		);
		expect(result).toMatchObject({ ok: true, kind: "fixture", files: 4 });
		expect(workspace).toEqual(["workspace/README.md.test", "workspace/src/a.ts"]);
		expect(output.notes).toEqual(["snapshot", "maskClashOmitted"]);
		expect(result.ok && result.notes).toEqual(["snapshot", "maskClashOmitted"]);
		expect(readFileSync(join(folder, "workspace", "README.md.test"), "utf8")).toBe(
			"contents of README.md\n",
		);
		expect(existsSync(join(folder, "session.jsonl"))).toBe(true);
		expect(provenance).toMatchObject({ snapshot: "turn tree", omitted: ["README.md.test"] });
	});

	test("a markdown file whose masked name is a folder of the tree is left out, the folder kept", async () => {
		const { output, result, provenance, workspace } = await snapshotFixture("fixture-folder", [
			"docs.md",
			"docs.md.test/guide.txt",
			"docs.md.test/deep/notes.md",
		]);
		expect(result).toMatchObject({ ok: true, kind: "fixture", files: 4 });
		expect(workspace).toEqual([
			"workspace/docs.md.test/deep/notes.md.test",
			"workspace/docs.md.test/guide.txt",
		]);
		expect(output.notes).toEqual(["snapshot", "maskClashOmitted"]);
		expect(provenance.omitted).toEqual(["docs.md"]);
	});

	test("without a clash every file is exported where the replay puts it back, with no note", async () => {
		const paths = ["README.md", "guide.md/intro.txt", "docs/TASK.md", "docs/TASK.mdx", "src/a.ts"];
		const { output, result, provenance, workspace } = await snapshotFixture("fixture-clean", paths);
		expect(result).toMatchObject({ ok: true, kind: "fixture", files: 7 });
		expect(workspace).toEqual([
			"workspace/README.md.test",
			"workspace/docs/TASK.md.test",
			"workspace/docs/TASK.mdx",
			"workspace/guide.md/intro.txt",
			"workspace/src/a.ts",
		]);
		expect(workspace.map((path) => replayed(path.slice("workspace/".length))).sort()).toEqual(
			[...paths].sort(),
		);
		expect(output.notes).toEqual(["snapshot"]);
		expect(Object.keys(provenance)).toEqual([
			"exportedBy",
			"sessionId",
			"revision",
			"cut",
			"entries",
			"recordedCwd",
			"snapshot",
		]);
	});

	test("a file whose path masking would change is left out with a masked note, the cut kept", async () => {
		const { output, result, folder, provenance, workspace } = await snapshotFixture(
			"fixture-private",
			[
				"customers/alice@example.com.json",
				`keys/${CORPUS.github[0]}.txt`,
				"config/API_KEY=hunter2hunter2.env",
				`${HOME}/notes.txt`,
				"src/a.ts",
			],
		);
		expect(result).toMatchObject({ ok: true, kind: "fixture", files: 3 });
		expect(workspace).toEqual(["workspace/src/a.ts"]);
		expect(output.notes).toEqual(["snapshot", "privatePathOmitted"]);
		expect(result.ok && result.notes).toEqual(["snapshot", "privatePathOmitted"]);
		expect(existsSync(join(folder, "session.jsonl"))).toBe(true);
		expect(readdirSync(join(folder, "workspace"), { recursive: true }).sort()).toEqual([
			"src",
			"src/a.ts",
		]);
		expect(provenance.omitted).toEqual([
			"config/API_KEY=[redacted]",
			"customers/[redacted]",
			"keys/[redacted].txt",
			"~/notes.txt",
		]);
		const written = readFileSync(join(folder, "insights-export.json"), "utf8");
		for (const raw of [CORPUS.email[0], CORPUS.github[0], "hunter2", HOME])
			expect(written).not.toContain(raw);
	});

	test("a name derived from the title never takes a shape masking would change", async () => {
		const trace = await traceOf(session("base-name"));
		for (const title of ["PK-1234 fix the long running import", "sk-learn migration plan here"]) {
			const base = exportBaseName(trace, title);
			expect(base).toBe("2026-11-01-redacted-export-b");
			expect(checkExport([], HOME, [], `fixtures/${base}-turn-1`)).toEqual([]);
		}
		expect(exportBaseName(trace, "Fix the parser")).toBe("2026-11-01-fix-the-parser-export-b");
	});

	test("a fixture name the masking would change fails the check, nothing written", async () => {
		const trace = await traceOf(session("fixture-named"));
		const output = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: "b",
			name: "sk-ant-api03-abcdefghijklmnopqrstuvwx",
			snapshot: async () => null,
			labels: null,
		});
		if (!output) throw new Error("expected an output");
		const where = target("fixture-named");
		expect(await writeExport(where, output, { home: HOME })).toMatchObject({
			ok: false,
			code: "CHECK_FAILED",
			found: ["keyShape"],
		});
		expect(existsSync(join(where.dir, EXPORT_RULES.folder))).toBe(false);
	});

	test("an event cut or a missing tree leaves the snapshot out with a note", async () => {
		const trace = await traceOf(session("fixture-none"));
		let asked = 0;
		const input = {
			trace,
			redactor: createRedactor(HOME),
			base: "b",
			snapshot: async () => {
				asked += 1;
				return null;
			},
			labels: { labels: ["good"], note: null },
		};
		const atEvent = await fixtureOutput({
			...input,
			cut: { kind: "event", eventId: trace.events[1]?.id ?? "" },
		});
		expect(asked).toBe(0);
		expect(atEvent?.notes).toEqual(["noSnapshot", "labels"]);
		const noTree = await fixtureOutput({
			...input,
			cut: { kind: "turn", turn: 2 },
			name: "My Fixture!",
		});
		expect(asked).toBe(1);
		expect(noTree?.name).toBe("fixtures/my-fixture");
		expect(noTree?.files.map((file) => file.path)).toEqual([
			"session.jsonl",
			"insights-export.json",
		]);
	});

	test("the turn's tree is the run that overlaps it most", () => {
		const early = { startedAt: 0, settledAt: 900 };
		const middle = { startedAt: 1000, settledAt: 5000 };
		const late = { startedAt: 4000, settledAt: 9000 };
		const runs = [early, middle, late];
		expect(receiptForTurn(runs, { t0: 1200, t1: 4500 })).toBe(middle);
		expect(receiptForTurn(runs, { t0: 9000, t1: 9500 })).toBe(late);
		expect(receiptForTurn(runs, { t0: 9100, t1: 9500 })).toBeNull();
	});

	test("names and paths follow the harness rules", () => {
		expect(fixturePath("docs/TASK.md")).toBe("docs/TASK.md.test");
		expect(fixturePath("src/a.mdx")).toBe("src/a.mdx");
		expect(fixtureName("  Brainstorming — mid flow!! ")).toBe("brainstorming-mid-flow");
	});
});

describe("credentials under secret-named arguments", () => {
	const secretSession = (name: string): Built => {
		const builder = sessionOf(`export-${name}`, [{ prompt: "Connect", calls: SECRET_CALLS }], {
			cwd: `${HOME}/repo`,
			start: T0,
		});
		return { file: writeSession(root, name, builder), builder, ids: {} };
	};

	test("never reach the Chrome trace, the page or the fixture of a custom tool's calls", async () => {
		const built = secretSession("secret-args");
		const trace = await traceOf(built);
		const chrome = chromeTraceOutput({ trace, title: "t", children: new Map(), base: "b" }, []);
		const html = await htmlOf(built);
		const fixture = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: "b",
			snapshot: async () => null,
			labels: null,
		});
		const texts = [String(chrome.files[0]?.content), html, String(fixture?.files[0]?.content)];
		for (const value of Object.values(SECRET_ARGS))
			for (const text of texts) expect(text).not.toContain(value);
		expect(await sourceCredentials([built.file])).toEqual(
			[...new Set(Object.values(SECRET_ARGS))].sort(),
		);
		const where = target("secret-args");
		expect((await writeExport(where, chrome, { home: HOME })).ok).toBe(true);
		if (fixture) expect((await writeExport(where, fixture, { home: HOME })).ok).toBe(true);
	});

	test("the check catches a source's credential that left its key, in a trace event's name or args", async () => {
		const built = secretSession("secret-planted");
		const known = await sourceCredentials([built.file]);
		const planted = (event: Record<string, unknown>) => [
			{ path: "", content: JSON.stringify({ traceEvents: [event] }), check: "json" as const },
		];
		const named = planted({ name: SECRET_ARGS.password, ph: "X", args: { tool: "db_connect" } });
		const inArgs = planted({ name: "set_env", args: { label: `${SECRET_ARGS.dbPassword}…` } });
		expect(checkExport(named, HOME)).toEqual([]);
		expect(checkExport(named, HOME, known)).toEqual(["jsonKey"]);
		expect(checkExport(inArgs, HOME, known)).toEqual(["jsonKey"]);
		const result = await writeExport(
			target("secret-planted"),
			{
				kind: "trace",
				name: "b.trace.json",
				folder: false,
				files: inArgs,
				notes: [],
				sources: [built.file],
			},
			{ home: HOME },
		);
		expect(result).toMatchObject({ ok: false, code: "CHECK_FAILED", found: ["jsonKey"] });
		expect(JSON.stringify(result)).not.toContain(SECRET_ARGS.dbPassword);
	});

	test("a long credential is known by its ends; words, placeholders and paths are not credentials", async () => {
		const long = `${"a1".repeat(40)}TAIL${"z9".repeat(20)}`;
		const builder = sessionOf(
			"export-credential-kinds",
			[
				{
					prompt: "Reset the password with the token",
					calls: [
						["login", { password: "password", token: "$API_TOKEN", sshKey: "~/.ssh/id_rsa" }],
						["login", { client_secret: "changeme", apiKey: "<your key>", note: "short1" }],
						["login", { secret: long }],
					],
				},
			],
			{ cwd: `${HOME}/repo`, start: T0 },
		);
		const file = writeSession(root, "credential-kinds", builder);
		const known = await sourceCredentials([file, join(root, "missing.jsonl")]);
		expect(known).toEqual([long.slice(0, 32), long.slice(-32)].sort());
		const cut = [{ path: "", content: `<p>${long.slice(0, 40)}…</p>`, check: "html" as const }];
		expect(checkExport(cut, HOME, known)).toEqual(["jsonKey"]);
		const words = [
			{ path: "", content: "<p>Reset the password with $API_TOKEN</p>", check: "html" as const },
		];
		expect(checkExport(words, HOME, known)).toEqual([]);
	});
});

describe("credentials inside secret-named containers", () => {
	const containedSession = (name: string): Built => {
		const builder = sessionOf(
			`export-${name}`,
			[{ prompt: "Rotate", calls: CONTAINED_SECRET_CALLS }],
			{ cwd: `${HOME}/repo`, start: T0 },
		);
		return { file: writeSession(root, name, builder), builder, ids: {} };
	};
	const fixtureOf = async (trace: BuiltTrace) => {
		const fixture = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: "b",
			snapshot: async () => null,
			labels: null,
		});
		if (!fixture) throw new Error("expected a fixture");
		return fixture;
	};

	test("never reach the fixture, the page or the Chrome trace, which all export", async () => {
		const built = containedSession("contained");
		const trace = await traceOf(built);
		const fixture = await fixtureOf(trace);
		const chrome = chromeTraceOutput({ trace, title: "t", children: new Map(), base: "b" }, []);
		const html = await htmlOf(built);
		const cut = String(fixture.files[0]?.content);
		for (const text of [cut, html, String(chrome.files[0]?.content)]) {
			for (const value of Object.values(CONTAINED_SECRETS)) expect(text).not.toContain(value);
			expect(text).not.toContain(String(CONTAINED_PIN));
		}
		expect(cut).toContain('"credentials":{"value":"[redacted]","pin":"[redacted]"}');
		expect(cut).toContain('"secrets":["[redacted]","[redacted]"]');
		expect(cut).toContain('"details":{"request":{"auth":{"headers":{"x":"[redacted]"}}}');
		const where = target("contained");
		for (const output of [fixture, chrome])
			expect((await writeExport(where, output, { home: HOME })).ok).toBe(true);
	});

	test("the check fails a planted unmasked copy, even one no source scan knows", async () => {
		const built = containedSession("contained-planted");
		const known = await sourceCredentials([built.file]);
		for (const value of Object.values(CONTAINED_SECRETS))
			expect(known.includes(value)).toBe(value !== CONTAINED_SECRETS.word);
		const json = (value: unknown) => [
			{ path: "a.json", content: JSON.stringify(value), check: "json" as const },
		];
		for (const planted of [
			{ credentials: { value: "abc" } },
			{ args: { secrets: ["[redacted]", CONTAINED_SECRETS.word] } },
			{ auth: { headers: { x: "h" } } },
		])
			expect(checkExport(json(planted), HOME)).toEqual(["jsonKey"]);
		expect(
			checkExport(json({ credentials: { value: "[redacted]", empty: "", pin: 1 } }), HOME),
		).toEqual([]);
		const fixture = await fixtureOf(await traceOf(built));
		const cut = String(fixture.files[0]?.content);
		const planted = cut.replace(
			'"secrets":["[redacted]","[redacted]"]',
			`"secrets":["[redacted]","${CONTAINED_SECRETS.word}"]`,
		);
		expect(planted).not.toBe(cut);
		const result = await writeExport(
			target("contained-planted"),
			{
				...fixture,
				files: fixture.files.map((file, at) => (at === 0 ? { ...file, content: planted } : file)),
			},
			{ home: HOME },
		);
		expect(result).toMatchObject({ ok: false, code: "CHECK_FAILED", found: ["jsonKey"] });
		expect(JSON.stringify(result)).not.toContain(CONTAINED_SECRETS.word);
	});
});

describe("a private key after a long prefix", () => {
	const key = rsa4096Key();
	const encrypted = key.block.replace(
		"-----\n",
		"-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\n\n",
	);
	const keySession = (name: string): Built => {
		const builder = new TranscriptBuilder({ id: `export-${name}`, cwd: `${HOME}/repo`, start: T0 });
		const ids: Record<string, string> = {};
		ids.prompt = builder.user(`Rotate the key:\n\n${encrypted}`);
		ids.call = builder.assistant({
			text: `Reading it.\n${key.lines.slice(20).join("\n")}`,
			toolCalls: [
				{ id: "p1", name: "bash", arguments: { command: "./diagnose.sh; cat deploy.pem" } },
				{
					id: "p2",
					name: "Agent",
					arguments: { subagent_type: "scout", task: `Check this key.\n\n${encrypted}` },
				},
			],
			usage: usage(100, 0.25),
		});
		builder.toolResult({
			toolCallId: "p1",
			toolName: "bash",
			text: `${diagnostics(12_000)}${key.block}`,
			isError: true,
		});
		builder.toolResult({
			toolCallId: "p2",
			toolName: "Agent",
			details: runDetails(CHILD, "completed", { tokens: 5, cost: 0.05 }),
			text: `${key.lines.slice(30).join("\n")}\n-----END RSA PRIVATE KEY-----`,
		});
		builder.assistant({ text: "Done.", usage: usage(50, 0.1) });
		return { file: writeSession(root, name, builder), builder, ids };
	};

	test("never reaches the page, the Chrome trace or the fixture, and every export passes its check", async () => {
		const built = keySession("key-prefix");
		const trace = await traceOf(built);
		const html = await htmlOf(built);
		const chrome = chromeTraceOutput({ trace, title: "t", children: new Map(), base: "b" }, []);
		const fixture = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: "b",
			snapshot: async () => null,
			labels: null,
		});
		for (const text of [
			html,
			String(chrome.files[0]?.content),
			String(fixture?.files[0]?.content),
		]) {
			expect(keyLeaks(text, key)).toEqual([]);
			expect(text).not.toContain("END RSA PRIVATE KEY");
		}
		expect(html).toContain("[redacted]");
		const where = target("key-prefix");
		const page = {
			kind: "html" as const,
			name: "key.html",
			folder: false,
			files: [{ path: "", content: html, check: "html" as const }],
			notes: [],
			sources: [built.file],
		};
		expect((await writeExport(where, page, { home: HOME })).ok).toBe(true);
		expect((await writeExport(where, chrome, { home: HOME })).ok).toBe(true);
		if (fixture) expect((await writeExport(where, fixture, { home: HOME })).ok).toBe(true);
	});

	test("the check refuses a page that shows the key's last lines without its BEGIN marker", async () => {
		const tail = key.block.slice(-1200);
		const result = await writeExport(
			target("key-tail"),
			{
				kind: "html",
				name: "tail.html",
				folder: false,
				files: [{ path: "", content: `<pre>head<span>…</span>${tail}</pre>`, check: "html" }],
				notes: [],
				sources: [],
			},
			{ home: HOME },
		);
		expect(result).toMatchObject({ ok: false, code: "CHECK_FAILED", found: ["privateKey"] });
		const interior = `<pre>${key.lines.slice(10, 14).join("\n")}</pre>`;
		expect(checkExport([{ path: "", content: interior, check: "html" }], HOME)).toEqual([
			"privateKey",
		]);
	});
});

describe("concurrent exports", () => {
	const PARALLEL = 8;

	test("of one session and kind take distinct names, each with its own bytes", async () => {
		const where = target("parallel-files");
		const outputs = Array.from({ length: PARALLEL }, (_, n) => ({
			kind: "html" as const,
			name: "same.html",
			folder: false,
			files: [{ path: "", content: `<p>request ${n}</p>`, check: "html" as const }],
			notes: [],
			sources: [],
		}));
		const results = await Promise.all(
			outputs.map((output) => writeExport(where, output, { home: HOME })),
		);
		const paths = results.map((result) => (result.ok ? result.path : result.code));
		expect(new Set(paths).size).toBe(PARALLEL);
		const folder = join(where.dir, EXPORT_RULES.folder);
		results.forEach((result, n) => {
			if (!result.ok) throw new Error(`export ${n} failed: ${result.code} ${result.detail}`);
			const leaf = result.path.split("/").at(-1) ?? "";
			expect(readFileSync(join(folder, leaf), "utf8")).toBe(`<p>request ${n}</p>`);
		});
		expect(readdirSync(folder).sort()).toEqual(
			["same.html", ...Array.from({ length: PARALLEL - 1 }, (_, n) => `same-${n + 2}.html`)].sort(),
		);
	});

	test("of one fixture take distinct folders, each with its own files", async () => {
		const where = target("parallel-folders");
		const outputs = Array.from({ length: PARALLEL }, (_, n) => ({
			kind: "fixture" as const,
			name: "fixtures/same",
			folder: true,
			files: [
				{ path: "session.jsonl", content: `${JSON.stringify({ n })}\n`, check: "jsonl" as const },
				{ path: "workspace/a.txt", content: `file ${n}`, check: "text" as const },
				{ path: "insights-export.json", content: JSON.stringify({ n }), check: "json" as const },
			],
			notes: [],
			sources: [],
		}));
		const results = await Promise.all(
			outputs.map((output) => writeExport(where, output, { home: HOME })),
		);
		const folder = join(where.dir, EXPORT_RULES.folder, "fixtures");
		const seen = new Set<string>();
		results.forEach((result, n) => {
			if (!result.ok) throw new Error(`export ${n} failed: ${result.code} ${result.detail}`);
			const leaf = result.path.split("/").at(-2) ?? "";
			seen.add(leaf);
			expect(readFileSync(join(folder, leaf, "workspace", "a.txt"), "utf8")).toBe(`file ${n}`);
			expect(JSON.parse(readFileSync(join(folder, leaf, "insights-export.json"), "utf8"))).toEqual({
				n,
			});
		});
		expect(seen.size).toBe(PARALLEL);
		expect(readdirSync(folder).filter((name) => name.startsWith("."))).toEqual([]);
	});

	test("without hard links or folder replacement still never replace another export", async () => {
		const dir = join(root, "no-links");
		mkdirSync(dir, { recursive: true });
		const refuse = async () => {
			throw Object.assign(new Error("not supported"), { code: "EPERM" });
		};
		const names = (n: number) => (n === 1 ? "x.html" : `x-${n}.html`);
		writeFileSync(join(dir, "x.html"), "earlier");
		writeFileSync(join(dir, ".a.partial"), "first");
		writeFileSync(join(dir, ".b.partial"), "second");
		const noLinks = { link: refuse, rename };
		const [a, b] = await Promise.all([
			publishFile(dir, names, join(dir, ".a.partial"), { ops: noLinks }),
			publishFile(dir, names, join(dir, ".b.partial"), { ops: noLinks }),
		]);
		expect([a, b].sort()).toEqual(["x-2.html", "x-3.html"]);
		expect(readFileSync(join(dir, "x.html"), "utf8")).toBe("earlier");
		expect(readFileSync(join(dir, a), "utf8")).toBe("first");
		expect(readFileSync(join(dir, b), "utf8")).toBe("second");

		const folders = (n: number) => (n === 1 ? "f" : `f-${n}`);
		mkdirSync(join(dir, "f"));
		for (const name of [".fa", ".fb"]) {
			mkdirSync(join(dir, name, "workspace"), { recursive: true });
			writeFileSync(join(dir, name, "session.jsonl"), name);
			writeFileSync(join(dir, name, "workspace", "a.txt"), name);
		}
		const noFolderRename = {
			link,
			rename: async (from: string, to: string) =>
				from.endsWith(".fa") || from.endsWith(".fb") ? refuse() : rename(from, to),
		};
		const entries = ["session.jsonl", "workspace"];
		const [fa, fb] = await Promise.all([
			publishFolder(dir, folders, join(dir, ".fa"), entries, { ops: noFolderRename }),
			publishFolder(dir, folders, join(dir, ".fb"), entries, { ops: noFolderRename }),
		]);
		expect([fa, fb].sort()).toEqual(["f-2", "f-3"]);
		expect(readdirSync(join(dir, "f"))).toEqual([]);
		expect(readFileSync(join(dir, fa, "workspace", "a.txt"), "utf8")).toBe(".fa");
		expect(readFileSync(join(dir, fb, "session.jsonl"), "utf8")).toBe(".fb");
		expect(existsSync(join(dir, ".fa")) || existsSync(join(dir, ".fb"))).toBe(false);
	});
});

describe("an aborted export", () => {
	const outputs = async (name: string): Promise<ExportOutput[]> => {
		const built = session(name);
		const trace = await traceOf(built);
		const fixture = await fixtureOutput({
			trace,
			cut: { kind: "turn", turn: 1 },
			redactor: createRedactor(HOME),
			base: "b",
			snapshot: async () => [
				{ path: "a.txt", bytes: new TextEncoder().encode("a\n") },
				{ path: "src/b.txt", bytes: new TextEncoder().encode("b\n") },
			],
			labels: null,
		});
		if (!fixture) throw new Error("expected a fixture");
		return [
			{
				kind: "html",
				name: "b.html",
				folder: false,
				files: [{ path: "", content: await htmlOf(built), check: "html" }],
				notes: [],
				sources: [built.file],
			},
			chromeTraceOutput({ trace, title: "t", children: new Map(), base: "b" }, []),
			fixture,
		];
	};
	/** Everything under the export folder but the fixtures' parent: published and temporary output. */
	const leftovers = (dir: string) => {
		const folder = join(dir, EXPORT_RULES.folder);
		return existsSync(folder)
			? readdirSync(folder, { recursive: true })
					.map(String)
					.filter((path) => path !== "fixtures")
			: [];
	};
	/**
	 * A signal that aborts with `reason` the first time the export checks it once its temporary output is
	 * whole on disk — the file, or the folder down to its last file —: after the last write, before the
	 * name is taken, however the runtime schedules the file operations.
	 */
	const abortedOnceWritten = (dir: string, output: ExportOutput, reason: unknown) => {
		const controller = new AbortController();
		const { signal } = controller;
		const parent = join(dir, EXPORT_RULES.folder, dirname(output.name));
		const last = output.folder ? (output.files.at(-1)?.path.split("/") ?? []) : [];
		const written = () =>
			existsSync(parent) &&
			readdirSync(parent).some(
				(entry) => entry.endsWith(".partial") && existsSync(join(parent, entry, ...last)),
			);
		const check = signal.throwIfAborted.bind(signal);
		signal.throwIfAborted = () => {
			if (!signal.aborted && written()) controller.abort(reason);
			check();
		};
		return signal;
	};

	test("writes nothing when its signal is aborted before it writes", async () => {
		const reason = new Error("switched off");
		for (const output of await outputs("abort-before")) {
			const where = target(`abort-before-${output.kind}`);
			await expect(
				writeExport(where, output, { home: HOME, signal: AbortSignal.abort(reason) }),
			).rejects.toBe(reason);
			expect(existsSync(join(where.dir, EXPORT_RULES.folder))).toBe(false);
		}
	});

	test("aborted while it writes publishes nothing and removes its temporary output", async () => {
		for (const output of await outputs("abort-writing")) {
			const where = target(`abort-writing-${output.kind}`);
			const reason = new Error("switched off");
			const signal = abortedOnceWritten(where.dir, output, reason);
			await expect(writeExport(where, output, { home: HOME, signal })).rejects.toBe(reason);
			expect(existsSync(join(where.dir, EXPORT_RULES.folder))).toBe(true);
			expect(leftovers(where.dir)).toEqual([]);
		}
	});

	test("aborted while a name is taken takes no other and leaves no reservation", async () => {
		const dir = join(root, "abort-publish");
		mkdirSync(dir, { recursive: true });
		const reason = new Error("switched off");
		const taken = () => Object.assign(new Error("taken"), { code: "EEXIST" });
		const file = new AbortController();
		writeFileSync(join(dir, ".x.partial"), "x");
		const names = (n: number) => (n === 1 ? "x.html" : `x-${n}.html`);
		const linkTaken = {
			link: async () => {
				file.abort(reason);
				throw taken();
			},
			rename,
		};
		await expect(
			publishFile(dir, names, join(dir, ".x.partial"), { ops: linkTaken, signal: file.signal }),
		).rejects.toBe(reason);

		const folder = new AbortController();
		mkdirSync(join(dir, ".f.partial"));
		writeFileSync(join(dir, ".f.partial", "session.jsonl"), "{}\n");
		const noFolderRename = {
			link,
			rename: async () => {
				folder.abort(reason);
				throw Object.assign(new Error("not supported"), { code: "EPERM" });
			},
		};
		await expect(
			publishFolder(
				dir,
				(n) => (n === 1 ? "f" : `f-${n}`),
				join(dir, ".f.partial"),
				["session.jsonl"],
				{ ops: noFolderRename, signal: folder.signal },
			),
		).rejects.toBe(reason);
		expect(readdirSync(dir).sort()).toEqual([".f.partial", ".x.partial"]);
		expect(readdirSync(join(dir, ".f.partial"))).toEqual(["session.jsonl"]);
	});

	test("the page and the fixture stop where their signal aborted", async () => {
		const built = session("abort-builders");
		const trace = await traceOf(built);
		const reason = new Error("switched off");
		const controller = new AbortController();
		await expect(
			fixtureOutput({
				trace,
				cut: { kind: "turn", turn: 1 },
				redactor: createRedactor(HOME),
				base: "b",
				snapshot: async () => {
					controller.abort(reason);
					return [];
				},
				labels: null,
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		await expect(
			cutSessionFile(
				trace,
				{ kind: "turn", turn: 1 },
				createRedactor(HOME),
				8,
				AbortSignal.abort(reason),
			),
		).rejects.toBe(reason);
		await expect(htmlOf(built, AbortSignal.abort(reason))).rejects.toBe(reason);
	});
});

describe("budgets", () => {
	test(
		"a 2,400-call session exports, checks and cuts in seconds, the page stays self-contained",
		async () => {
			const builder = new TranscriptBuilder({ id: "large-export", cwd: `${HOME}/repo`, start: T0 });
			for (let turn = 0; turn < 120; turn += 1) {
				builder.user(`turn ${turn}: look at ${HOME}/repo/src/file${turn}.ts`);
				for (let call = 0; call < 20; call += 1) {
					builder.assistant({
						text: "Working.",
						toolCalls: [{ id: `c${turn}-${call}`, name: "read", arguments: { path: "a.ts" } }],
						usage: usage(100, 0.01),
					});
					builder.toolResult({
						toolCallId: `c${turn}-${call}`,
						toolName: "read",
						text: "x".repeat(2_000),
					});
				}
			}
			const built = { file: writeSession(root, "large-export", builder), builder, ids: {} };
			let started = performance.now();
			const html = await htmlOf(built);
			const render = performance.now() - started;
			started = performance.now();
			expect(checkExport([{ path: "", content: html, check: "html" }], HOME)).toEqual([]);
			const check = performance.now() - started;
			started = performance.now();
			expect(await sourceCredentials([built.file])).toEqual([]);
			const credentials = performance.now() - started;
			const trace = await traceOf(built);
			started = performance.now();
			const json = chromeTraceOutput({ trace, title: "t", children: new Map(), base: "b" }, []);
			const chrome = performance.now() - started;
			started = performance.now();
			const cut = await cutSessionFile(trace, { kind: "turn", turn: 60 }, createRedactor(HOME));
			const fixture = performance.now() - started;
			withinBudget(render, 3_000);
			withinBudget(check, 1_000);
			withinBudget(credentials, 500);
			withinBudget(chrome, 500);
			withinBudget(fixture, 1_000);
			expect(cut?.entries).toBe(60 * 41);
			expect(networkReferences(html)).toEqual([]);
			expect(json.files[0]?.content.length).toBeGreaterThan(0);
			console.info(
				`export budgets: html ${Math.round(render)} ms (${(html.length / 1e6).toFixed(1)} MB), check ${Math.round(check)} ms, credentials ${Math.round(credentials)} ms, trace ${Math.round(chrome)} ms, cut ${Math.round(fixture)} ms`,
			);
		},
		LARGE_TEST_MS,
	);
});

describe("export params", () => {
	test("validate ids, the labels switch, the cut and the name", () => {
		expect(parseExportParams({ sessionId: "s", workspaceId: "w" }, "export.html")).toEqual({
			sessionId: "s",
			workspaceId: "w",
			includeLabels: false,
		});
		expect(
			parseExportFixtureParams(
				{
					sessionId: "s",
					workspaceId: "w",
					includeLabels: true,
					cut: { kind: "turn", turn: 2 },
					name: "a-b",
				},
				"export.fixture",
			),
		).toEqual({
			sessionId: "s",
			workspaceId: "w",
			includeLabels: true,
			cut: { kind: "turn", turn: 2 },
			name: "a-b",
		});
		for (const params of [
			null,
			{ sessionId: "s" },
			{ sessionId: "s", workspaceId: "w", includeLabels: "yes" },
			{ sessionId: "s", workspaceId: "w", cut: { kind: "turn", turn: 0 } },
			{ sessionId: "s", workspaceId: "w", cut: { kind: "event", eventId: "" } },
			{ sessionId: "s", workspaceId: "w", name: "!!!" },
		])
			expect(() => parseExportFixtureParams(params, "export.fixture")).toThrow(
				"Invalid export.fixture params",
			);
	});
});
