import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cached, TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import {
	CONTAINED_SECRET_CALLS,
	CONTAINED_SECRETS,
	SECRET_ARGS,
	SECRET_CALLS,
	sessionOf,
} from "../test/calls.ts";
import { ALPHA, BETA, corpusId, writeInsightsCorpus } from "../test/corpus.ts";
import {
	InsightsEngine,
	type InsightsRequest,
	parseInsightsArgs,
	runInsights,
	shortIds,
	vanillaInsightsLocations,
} from "./insightsCommand.ts";

process.env.TZ = "UTC";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function agentDir(prefix: string): string {
	const dir = tempDir(prefix);
	roots.push(dir);
	return dir;
}

const corpusDir = agentDir("corpus");
const ids = writeInsightsCorpus(corpusDir);

function request(args: string): InsightsRequest {
	const parsed = parseInsightsArgs(args);
	if (!parsed.ok) throw new Error(parsed.message);
	return parsed.request;
}

async function report(args: string, cwd = ALPHA, dir = corpusDir): Promise<string> {
	const engine = new InsightsEngine(vanillaInsightsLocations(dir));
	return runInsights(engine, request(args), {
		cwd,
		contextWindow: async () => 200_000,
		progressMs: 20,
	});
}

describe("/insights arguments", () => {
	test("flags, a session by flag, by `=` or bare, and the errors", () => {
		expect(parseInsightsArgs("")).toEqual({
			ok: true,
			request: { all: false, sessionId: null, html: false, trace: false, help: false },
		});
		expect(parseInsightsArgs(" --all  --html --trace ")).toEqual({
			ok: true,
			request: { all: true, sessionId: null, html: true, trace: true, help: false },
		});
		for (const args of ["--session 019a3b10", "--session=019a3b10", "019a3b10", "-s 019a3b10"])
			expect(parseInsightsArgs(args)).toMatchObject({
				ok: true,
				request: { sessionId: "019a3b10" },
			});
		expect(parseInsightsArgs("-h")).toMatchObject({ ok: true, request: { help: true } });
		for (const [args, message] of [
			["--session", "--session needs a session id."],
			["--session --all", "--session needs a session id."],
			["--sort cost", "Unknown option --sort."],
			["a1b2 c3d4", "Give one session at a time."],
			["../etc", "Not a session id: ../etc"],
		] as const) {
			const parsed = parseInsightsArgs(args);
			expect(parsed.ok).toBe(false);
			if (!parsed.ok) {
				expect(parsed.message.startsWith(message)).toBe(true);
				expect(parsed.message).toContain("Usage: /insights");
			}
		}
	});

	test("short ids are unique prefixes of at least eight characters that never end on a dash", () => {
		const short = shortIds(["019a3b10-aaaa", "019a3b10-aaab", "019a4c22-0000", "x"]);
		expect(short("019a3b10-aaaa")).toBe("019a3b10-aaaa");
		expect(short("019a4c22-0000")).toBe("019a4c22");
		expect(short("x")).toBe("x");
		expect(shortIds(["019a3b10-1", "019a3b10-2"])("019a3b10-1")).toBe("019a3b10-1");
		expect(shortIds(["019a3b10-12", "019a3b11-00"])("019a3b10-12")).toBe("019a3b10");
	});
});

describe("/insights reports", () => {
	test("the current folder's findings, usage and latest sessions", async () => {
		const text = await report("");
		const lines = text.split("\n");
		expect(lines[0]).toBe("Session insights · /work/alpha · 6 sessions · 2026-11-03 – 2026-11-08");
		expect(text).toContain("Top findings");
		expect(text).toContain("✗ “bun test” fails in 6 of 9 runs (67%, 95% CI 35–88%) in 3 sessions");
		expect(text).toContain("“error: expected 3 to equal 4”");
		expect(text).toContain("2 skills listed but never loaded: brainstorming, release");
		expect(text).toContain("1 session cost over 3× the median $0.40: $7.10 (019a4602)");
		expect(text).toContain("Rework: src/app.ts changed 6 times in one session (019a425c)");
		expect(text).toContain("pi's total misses $0.42 of subagent spend in 1 session");
		expect(text).toContain("  Cost      $8.80 recorded by pi");
		expect(text).toContain("            + $0.42 subagent spend outside pi's total");
		expect(text).toContain("  Models    anthropic/claude-test $8.80 (100%)");
		expect(text).toContain("  Tools     bash 9 (6 failed) · edit 9 · read 9 · Agent 1");
		expect(text).toContain("Recent sessions (5 of 6)");
		expect(text).toContain("More: /insights --all");
		// Beta's sessions and folder stay out of the current folder's report.
		for (const id of ids.beta) expect(text).not.toContain(id.slice(0, 8));
		expect(text).not.toContain(BETA);
		expect(text).not.toContain("Folders");
	});

	test("--all covers every folder and lists the folders by spend", async () => {
		const text = await report("--all");
		expect(text.split("\n")[0]).toBe(
			"Session insights · all folders · 8 sessions · 2026-11-03 – 2026-11-10",
		);
		expect(text).toContain("  Folders   /work/alpha $8.80 · /work/beta $0.13");
		expect(text).toContain("019a49a8  2026-11-10 10:00  3.4k tok  0 calls");
		expect(text).not.toContain("More: /insights --all");
	});

	test("provenance marks: estimates, lower bounds and unrecorded cost, with a legend of the marks used", async () => {
		const scoped = await report("");
		expect(scoped).toContain("active ≈");
		expect(scoped).toContain("≈ estimate");
		expect(scoped).not.toContain("≥ partly recorded");
		const all = await report("--all");
		expect(all).toContain("  Cost      ≥$8.93 recorded by pi; some calls record no cost");
		expect(all).toContain("claude-bridge/opus 3.4k tokens (cost not recorded?)");
		expect(all).toContain(
			"≈ estimate · ≥ partly recorded (a lower bound) · ? not measured or not recorded",
		);
		const unpriced = await report(`--session ${corpusId(8)}`, BETA);
		expect(unpriced).toContain("  Cost      not recorded? (3.4k tokens)");
		expect(unpriced).toContain("? not measured or not recorded");
	});

	test("a subagent that cannot be measured is marked, not counted as zero", async () => {
		const dir = agentDir("unmeasured");
		const builder = new TranscriptBuilder({ id: corpusId(20), cwd: ALPHA });
		builder.user("Delegate the search");
		builder.assistant({
			toolCalls: [{ id: "a1", name: "Agent", arguments: { task: "Search" } }],
			usage: cached({ input: 1000 }, 0.02),
		});
		builder.toolResult({
			toolCallId: "a1",
			toolName: "Agent",
			details: { childSessionId: "lost-child", status: "running" },
		});
		builder.assistant({ text: "Waiting.", usage: cached({ input: 1000 }, 0.02) });
		writeSession(join(dir, "sessions"), "--work-alpha--", builder);
		const text = await report(corpusId(20), ALPHA, dir);
		expect(text).toContain(" · 1? subagent");
		expect(text).toContain(
			"+ ? subagent spend outside pi's total (a subagent could not be measured)",
		);
		expect(text).toContain("? not measured or not recorded");
		const overview = await report("", ALPHA, dir);
		expect(overview).toContain("1? subagent run");
	});

	test("--session: one session's work, spend, context peak, cost diagnosis, errors and turns", async () => {
		const text = await report(`--session ${corpusId(3).slice(0, 8)}`, "/anywhere");
		expect(text.split("\n")[0]).toBe("Session 019a4089 · Make the parser tests pass, round 3");
		expect(text).toContain("  Folder    /work/alpha");
		expect(text).toContain(
			"  Work      1 turn · 7 model calls · 6 tool calls (2 failed) · 1 subagent",
		);
		expect(text).toContain("  Cost      $0.40 recorded by pi");
		expect(text).toContain("            + $0.42 subagent spend outside pi's total");
		expect(text).toContain(
			"  Context   peak 20k tokens of anthropic/claude-test's 200k window (10%)",
		);
		expect(text).toContain("  Why       No single cause stands out: 7 calls at a median $0.05.");
		expect(text).toContain(
			"  Errors    2 tool failures in 1 chain: 1 recovered (retries are a heuristic)",
		);
		expect(text).toContain("most common: bash ×2 “error: expected 3 to equal 4”");
		expect(text).toContain("Turns\n    1  10:00");
		expect(await report(corpusId(3))).toBe(text);
	});

	test("an unknown or ambiguous session id says so", async () => {
		expect(await report("--session 0000ffff")).toBe(
			"No pi session has an id starting with 0000ffff.",
		);
		expect(await report("--session 019a")).toBe(
			"019a matches 8 sessions (019a49a8, 019a47d5, 019a4602, 019a442f, 019a425c, +3 more); give more of the id.",
		);
	});

	test("no sessions at all, and none in this folder", async () => {
		const empty = agentDir("empty");
		const none = await report("", ALPHA, empty);
		expect(none.split("\n")[0]).toBe(`No pi sessions found in ${join(empty, "sessions")}.`);
		const elsewhere = await report("", "/work/gamma");
		expect(elsewhere).toContain("No pi sessions were started in /work/gamma.");
		expect(elsewhere).toContain(
			"8 sessions in other folders: run /insights --all to include them.",
		);
	});

	test("--html and --trace write the session's exports under the agent dir and print their paths", async () => {
		const dir = agentDir("exports");
		writeInsightsCorpus(dir);
		const text = await report(`--session ${corpusId(3)} --html --trace`, ALPHA, dir);
		const folder = join(dir, "session-insights");
		const written = readdirSync(folder)
			.filter((name) => name !== "cache")
			.sort();
		expect(written).toEqual([
			"2026-11-05-make-the-parser-tests-pass-round-3-019a4089.html",
			"2026-11-05-make-the-parser-tests-pass-round-3-019a4089.trace.json",
		]);
		const html = join(folder, written[0] ?? "");
		const trace = join(folder, written[1] ?? "");
		expect(text).toContain(`  HTML      ${html}`);
		expect(text).toContain(`  Trace     ${trace} (Perfetto UI, chrome://tracing or speedscope)`);
		expect(readFileSync(html, "utf8")).toStartWith("<!doctype html>");
		expect(JSON.parse(readFileSync(trace, "utf8")).traceEvents.length).toBeGreaterThan(0);
		// Without --session the latest session in scope is exported; a second export never overwrites.
		const again = await report("--html", ALPHA, dir);
		expect(again).toContain("2026-11-08-migrate-the-storage-layer-019a4602.html");
		expect(existsSync(join(folder, "2026-11-08-migrate-the-storage-layer-019a4602.html"))).toBe(
			true,
		);
	});

	test("a custom tool's credentials appear in no report and no export", async () => {
		const dir = agentDir("secret-args");
		const id = "019a0000-5ec2-7000-8000-000000000001";
		const builder = sessionOf(
			id,
			[{ prompt: "Connect the services", calls: [...SECRET_CALLS, ...CONTAINED_SECRET_CALLS] }],
			{ cwd: ALPHA },
		);
		writeSession(join(dir, "sessions"), "--work-alpha--", builder);
		const text = await report(`--session ${id} --html --trace`, ALPHA, dir);
		const overview = await report("", ALPHA, dir);
		const folder = join(dir, "session-insights");
		const written = readdirSync(folder).filter((name) => name !== "cache");
		expect(written).toHaveLength(2);
		const outputs = [
			text,
			overview,
			...written.map((name) => readFileSync(join(folder, name), "utf8")),
		];
		for (const value of [...Object.values(SECRET_ARGS), ...Object.values(CONTAINED_SECRETS)])
			for (const output of outputs) expect(output).not.toContain(value);
	});

	test("the summary cache lands in <agentDir>/session-insights/cache, never in pi's folders", async () => {
		const dir = agentDir("cache");
		writeInsightsCorpus(dir);
		await report("", ALPHA, dir);
		expect(readdirSync(join(dir, "session-insights", "cache"))).toEqual(["summaries.v1.jsonl"]);
		expect(readdirSync(dir).sort()).toEqual(["delegation", "session-insights", "sessions"]);
	});

	test("the same files give the same report, warm or cold", async () => {
		const engine = new InsightsEngine(vanillaInsightsLocations(corpusDir));
		const io = { cwd: ALPHA, contextWindow: async () => 200_000 };
		const first = await runInsights(engine, request("--all"), io);
		expect(await runInsights(engine, request("--all"), io)).toBe(first);
		expect(await report("--all")).toBe(first);
	});

	test("progress is reported while indexing and reading sessions", async () => {
		const dir = agentDir("progress");
		writeInsightsCorpus(dir);
		const messages: string[] = [];
		await runInsights(new InsightsEngine(vanillaInsightsLocations(dir)), request(""), {
			cwd: ALPHA,
			progress: (message) => messages.push(message),
			progressMs: 0,
		});
		expect(messages.at(-1)).toBe("summing up…");
		expect(messages.every((message) => message.endsWith("…"))).toBe(true);
	});

	test("--help answers the usage without reading anything", async () => {
		const text = await runInsights(
			new InsightsEngine(vanillaInsightsLocations(join(corpusDir, "missing"))),
			request("--help"),
			{ cwd: ALPHA },
		);
		expect(text.startsWith("Usage: /insights")).toBe(true);
		expect(existsSync(join(corpusDir, "missing"))).toBe(false);
	});

	test("no network: the run never calls fetch", async () => {
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = Object.assign(
			async () => {
				calls += 1;
				throw new Error("network");
			},
			{ preconnect: () => {} },
		);
		try {
			await report("--all --html --trace", ALPHA, corpusDir);
			await report(`--session ${corpusId(1)}`);
		} finally {
			globalThis.fetch = original;
		}
		expect(calls).toBe(0);
	});
});
