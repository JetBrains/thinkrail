import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { TranscriptBuilder, tempDir, writeSession } from "../test/builders.ts";
import {
	CONTAINED_SECRET_CALLS,
	CONTAINED_SECRETS,
	SECRET_ARGS,
	sessionOf,
} from "../test/calls.ts";
import { diagnostics, keyLeaks, rsa4096Key } from "../test/pem.ts";
import { statsOver } from "../test/stats.ts";
import type { IndexState, SearchHit, SessionsSearchParams, SessionsSearchResult } from "./core.ts";
import type { StatsInput } from "./crossSession.ts";
import { createRedactor } from "./redact.ts";
import { SearchJobs } from "./search.ts";
import { SessionIndex } from "./sessionIndex.ts";

const root = tempDir("search");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const DAY = 86_400_000;
const START = Date.parse("2026-11-01T10:00:00.000Z");
const LINT_ERROR =
	"src/parser.ts:3:1 error  Unexpected any  no-explicit-any\nCommand exited with code 1";

function call(
	builder: TranscriptBuilder,
	id: string,
	name: string,
	args: Record<string, unknown>,
	result: { text: string; isError?: boolean },
	model?: string,
): string {
	const entry = builder.assistant({
		toolCalls: [{ id, name, arguments: args }],
		...(model ? { model } : {}),
	});
	builder.toolResult({
		toolCallId: id,
		toolName: name,
		text: result.text,
		isError: result.isError === true,
	});
	return `tool:${entry}:0`;
}

type FixtureId =
	| "oldPrompt"
	| "read"
	| "oldLint"
	| "fix"
	| "reply"
	| "prompt"
	| "newLint"
	| "edit"
	| "ruPrompt"
	| "ruGrep";

/** Three sessions: two in Alpha that fail `bun run lint`, one in Beta written in Russian. */
function fixtures(dir: string): { files: string[]; ids: Record<FixtureId, string> } {
	const ids = {} as Record<FixtureId, string>;
	const old = new TranscriptBuilder({ id: "lint-old", cwd: "/work/a", start: START });
	ids.oldPrompt = old.user("Make the linter happy");
	ids.read = call(
		old,
		"o1",
		"read",
		{ path: "src/parser.ts" },
		{ text: "export const x: any = 1;" },
	);
	ids.oldLint = call(
		old,
		"o2",
		"bash",
		{ command: "bun run lint" },
		{ text: LINT_ERROR, isError: true },
	);
	ids.fix = call(old, "o3", "bash", { command: "bun run lint --fix" }, { text: "Fixed 1 file" });
	ids.reply = old.assistant({ text: "Done, the lint passes now." });

	const fresh = new TranscriptBuilder({ id: "skills-new", cwd: "/work/a", start: START + 2 * DAY });
	ids.prompt = fresh.user("Review the parser with the review skill");
	call(
		fresh,
		"n1",
		"read",
		{ path: "/opt/skills/review-pr/SKILL.md" },
		{ text: "# Review" },
		"claude-opus",
	);
	ids.newLint = call(
		fresh,
		"n2",
		"bash",
		{ command: "bun run lint" },
		{ text: LINT_ERROR, isError: true },
		"claude-opus",
	);
	ids.edit = call(
		fresh,
		"n3",
		"edit",
		{ path: "/work/a/src/parser.ts", edits: [] },
		{ text: "Edited" },
		"claude-opus",
	);
	fresh.assistant({ text: "Reviewed.", model: "claude-opus" });

	const beta = new TranscriptBuilder({ id: "beta-ru", cwd: "/work/b", start: START + DAY });
	ids.ruPrompt = beta.user("Найди ОШИБКА в логах");
	ids.ruGrep = call(
		beta,
		"b1",
		"bash",
		{ command: "grep -r ошибка logs" },
		{ text: "logs/app.log: ошибка: диск заполнен\nCommand exited with code 1", isError: true },
	);
	return {
		files: [
			writeSession(dir, "a-old", old),
			writeSession(dir, "a-new", fresh),
			writeSession(dir, "b", beta),
		],
		ids,
	};
}

const READY: IndexState = { phase: "ready", indexed: 3, total: 3 };

interface Harness {
	input: StatsInput;
	jobs: SearchJobs;
	ask(query: string, extra?: Partial<SessionsSearchParams>): Promise<SessionsSearchResult>;
	/** Every answer of one query, following `next` and each group's `more`, and the hits in order. */
	drain(query: string): Promise<{ answers: SessionsSearchResult[]; hits: SearchHit[] }>;
}

async function harness(
	files: readonly string[],
	options: ConstructorParameters<typeof SearchJobs>[0] = {},
): Promise<Harness> {
	const { input } = await statsOver(files);
	const jobs = new SearchJobs({ redactor: createRedactor("/home/tester"), ...options });
	let seq = 0;
	const nextSeq = () => {
		seq += 1;
		return seq;
	};
	const params = (
		query: string,
		extra: Partial<SessionsSearchParams> = {},
	): SessionsSearchParams => ({
		scope: { kind: "all" },
		client: "panel",
		seq: extra.seq ?? nextSeq(),
		query,
		...extra,
	});
	const ask = (query: string, extra: Partial<SessionsSearchParams> = {}) =>
		jobs.run(input, READY, params(query, extra));
	return {
		input,
		jobs,
		ask,
		async drain(query) {
			const answers: SessionsSearchResult[] = [];
			const hits: SearchHit[] = [];
			const collect = async (groups: SessionsSearchResult["groups"], seq: number) => {
				for (const group of groups) {
					hits.push(...group.events);
					if (group.more)
						await collect((await ask(query, { seq, cursor: group.more })).groups, seq);
				}
			};
			let answer = await ask(query);
			for (;;) {
				answers.push(answer);
				await collect(answer.groups, answer.seq);
				if (!answer.next) break;
				answer = await ask(query, { seq: answer.seq, cursor: answer.next });
			}
			return { answers, hits };
		},
	};
}

describe("search across sessions", () => {
	let files: string[] = [];
	let ids = {} as Record<FixtureId, string>;
	beforeAll(() => {
		({ files, ids } = fixtures(join(root, "fixtures")));
	});

	test("filters and free text find a failing lint call with a highlighted snippet and facet counts", async () => {
		const { ask } = await harness(files);
		const answer = await ask("tool:bash error:yes lint");
		expect(answer.status).toBe("done");
		expect(answer.total).toEqual({ events: 2, sessions: 2, exact: true });
		expect(answer.sessions.map((session) => session.sessionId)).toEqual(["skills-new", "lint-old"]);
		const [newest, oldest] = answer.groups;
		expect(newest?.events.map((hit) => hit.eventId)).toEqual([ids.newLint]);
		expect(oldest?.events.map((hit) => hit.eventId)).toEqual([ids.oldLint]);
		const hit = newest?.events[0];
		expect(hit).toMatchObject({
			kind: "tool",
			turn: 1,
			tool: "bash",
			model: "anthropic/claude-opus",
			skill: "review-pr",
			error: true,
			label: "bun run lint",
			errorLine: "src/parser.ts:3:1 error Unexpected any no-explicit-any",
			fields: [{ field: "args", count: 1 }],
		});
		expect(hit?.snippet).toEqual({
			field: "args",
			text: "bun run lint",
			marks: [[8, 12]],
			head: false,
			tail: false,
		});
		expect(answer.facets.tool).toEqual({ values: [{ value: "bash", count: 2 }], others: 0 });
		expect(answer.facets.error).toEqual({ yes: 2, no: 0 });
		expect(answer.facets.model.values.map((item) => item.value)).toEqual([
			"anthropic/claude-opus",
			"anthropic/claude-test",
		]);
		expect(answer.facets.skill.values).toEqual([
			{ value: "", count: 1 },
			{ value: "review-pr", count: 1 },
		]);
		expect(answer.facets.project.values).toEqual([{ value: "Alpha", count: 2 }]);
		expect(answer.query.filters.map((filter) => filter.key)).toEqual(["tool", "error"]);
	});

	test("free text counts every field it occurs in and finds prompts and replies", async () => {
		const { ask } = await harness(files);
		const answer = await ask("lint");
		const hits = answer.groups.flatMap((group) => group.events);
		expect(hits.map((hit) => hit.eventId)).toEqual([
			ids.newLint,
			ids.oldPrompt,
			ids.oldLint,
			ids.fix,
			ids.reply,
		]);
		const reply = hits.find((hit) => hit.eventId === ids.reply);
		expect(reply).toMatchObject({ kind: "llm", label: "Done, the lint passes now." });
		expect(reply?.snippet?.field).toBe("reply");
		const old = await ask("linter");
		expect(old.groups.flatMap((group) => group.events.map((hit) => hit.kind))).toEqual(["turn"]);
		const parser = await ask("parser.ts error:yes");
		const lint = parser.groups.flatMap((group) => group.events)[0];
		expect(lint?.fields).toEqual([{ field: "error", count: 1 }]);
		expect(lint?.snippet?.field).toBe("error");
		expect(lint?.snippet?.text).toContain("src/parser.ts:3:1 error");
	});

	test("filters alone count from the columns, without free text or a snippet", async () => {
		const { ask } = await harness(files);
		const reads = await ask("tool:read");
		expect(reads.total).toEqual({ events: 2, sessions: 2, exact: true });
		expect(reads.groups.flatMap((group) => group.events.map((hit) => hit.label))).toEqual([
			"/opt/skills/review-pr/SKILL.md",
			"src/parser.ts",
		]);
		expect(reads.groups.every((group) => group.events.every((hit) => hit.snippet === null))).toBe(
			true,
		);
		const touched = await ask("file:parser.ts");
		expect(touched.groups.flatMap((group) => group.events.map((hit) => hit.eventId))).toEqual([
			ids.edit,
			ids.read,
		]);
		const skill = await ask("skill:review-pr");
		expect(skill.total.events).toBe(5);
		expect(
			skill.groups.flatMap((group) =>
				group.events.flatMap((hit) => (hit.kind === "tool" ? [hit.eventId] : [])),
			),
		).toEqual([ids.newLint, ids.edit]);
		expect((await ask("skill:none tool:edit")).total.events).toBe(0);
		expect((await ask("model:OPUS tool:bash")).total.events).toBe(1);
		expect((await ask("project:beta")).groups.map((group) => group.matches)).toEqual([3]);
		expect((await ask("project:none")).total.events).toBe(0);
		expect((await ask('error:"unexpected any"')).total.events).toBe(2);
		expect((await ask("error:no tool:bash")).total.events).toBe(1);
		expect((await ask("error:yes error:no tool:bash")).total.events).toBe(4);
	});

	test("label: keeps the sessions carrying one of the user's labels, label:none the rest", async () => {
		const { ask, input } = await harness(files);
		const labels = new Map([
			["beta-ru", ["Good"]],
			["lint-old", ["good", "slow"]],
		]);
		input.labelsOf = (sessionId) => labels.get(sessionId) ?? [];
		const sessionsOf = (answer: SessionsSearchResult) =>
			answer.groups.map((group) => answer.sessions[group.session]?.sessionId);
		expect(sessionsOf(await ask("label:GOOD"))).toEqual(["beta-ru", "lint-old"]);
		expect(sessionsOf(await ask("label:slow tool:bash"))).toEqual(["lint-old"]);
		expect(sessionsOf(await ask("label:none"))).toEqual(["skills-new"]);
		expect((await ask("label:missing")).total.events).toBe(0);
		const vocabulary = (await ask("", { facets: true })).vocabulary;
		expect(vocabulary?.label.map((item) => item.value)).toEqual(["good", "slow"]);
	});

	test("an empty query lists nothing but sends the scope's vocabulary", async () => {
		const { ask } = await harness(files);
		const answer = await ask("", { facets: true });
		expect(answer.status).toBe("done");
		expect(answer.groups).toEqual([]);
		const vocabulary = answer.vocabulary;
		expect(vocabulary?.complete).toBe(true);
		expect(vocabulary?.tool).toEqual([
			{ value: "bash", count: 4 },
			{ value: "read", count: 2 },
			{ value: "edit", count: 1 },
		]);
		expect(vocabulary?.file).toEqual([{ value: "src/parser.ts", count: 2 }]);
		expect(vocabulary?.skill).toEqual([{ value: "review-pr", count: 5 }]);
		expect(vocabulary?.error.map((item) => item.count)).toEqual([2, 1]);
		expect(vocabulary?.error[0]?.value).toStartWith("bash: ");
		expect(vocabulary?.project).toEqual([
			{ value: "Alpha", count: 16 },
			{ value: "Beta", count: 3 },
		]);
		expect((await ask("lint")).vocabulary).toBeNull();
	});

	test("non-ASCII terms match regardless of case", async () => {
		const { ask } = await harness(files);
		const answer = await ask("ошибка");
		expect(answer.groups.flatMap((group) => group.events.map((hit) => hit.eventId))).toEqual([
			ids.ruPrompt,
			ids.ruGrep,
		]);
		const grep = answer.groups[0]?.events[1];
		expect(grep?.fields).toEqual([
			{ field: "args", count: 1 },
			{ field: "error", count: 1 },
		]);
		expect(grep?.snippet?.marks).toEqual([[8, 14]]);
		expect(answer.groups[0]?.events[0]?.snippet?.text).toBe("Найди ОШИБКА в логах");
	});

	test("the same query gives the same answer", async () => {
		const first = await (await harness(files)).ask("lint error:yes", { facets: true });
		const second = await (await harness(files)).ask("lint error:yes", { facets: true });
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});

describe("search snippets around a key", () => {
	const key = rsa4096Key();
	let files: string[] = [];
	beforeAll(() => {
		const builder = new TranscriptBuilder({ id: "key-search", cwd: "/work/k", start: START });
		builder.user("Print the deploy key");
		call(
			builder,
			"k1",
			"bash",
			{ command: "./diagnose.sh; cat deploy.pem" },
			{
				text: `${diagnostics(12_000)}${key.block}\nCommand exited with code 1`,
				isError: true,
			},
		);
		call(
			builder,
			"k2",
			"bash",
			{ command: "./diagnose.sh --all" },
			{
				text: `${diagnostics(200_000)}${key.block}\n${diagnostics(500)}`,
			},
		);
		files = [writeSession(join(root, "key"), "key-search", builder)];
	});

	test("a term next to or inside the key shows a masked snippet", async () => {
		const { drain } = await harness(files);
		for (const query of ['"END RSA PRIVATE KEY"', key.lines[30]?.slice(8, 40) ?? ""]) {
			const { hits } = await drain(query);
			expect(hits).toHaveLength(2);
			for (const hit of hits) {
				expect(hit.snippet).not.toBeNull();
				expect(keyLeaks(JSON.stringify(hit), key)).toEqual([]);
				expect(JSON.stringify(hit)).not.toContain("END RSA PRIVATE KEY");
			}
		}
	});
});

describe("the byte prefilter", () => {
	const tricky = [
		'say "hi" to the parser',
		"C:\\work\\parser.ts failed",
		"tab\tseparated\tcolumns",
		"Ошибка: ДИСК заполнен",
		"ok \u212A kelvin, not k",
		"İstanbul and istanbul",
		"emoji 🚀 launch",
		"ANSI \u001b[31mred\u001b[0m text",
		"line one\nline two",
	];

	test("finds exactly what a full parse of every line finds", async () => {
		const builder = new TranscriptBuilder({ id: "tricky", cwd: "/work/a", start: START });
		tricky.forEach((text, at) => {
			builder.user(text);
			call(builder, `t${at}`, "bash", { command: `echo ${text}` }, { text: `${text}\n${at}` });
			builder.assistant({ text: `Reply: ${text.toUpperCase()}` });
		});
		const file = writeSession(join(root, "tricky"), "a", builder);
		const fast = await harness([file]);
		const full = await harness([file], { prefilter: false });
		const queries = [
			'"say \\"hi\\""',
			"c:\\work",
			"\\work",
			"tab\tseparated",
			"ошибка",
			"ДИСК",
			"kelvin",
			"k",
			"ok",
			"istanbul",
			"İSTANBUL",
			"🚀",
			"31mred",
			"red",
			"one\nline",
			"reply:",
			"zzz-absent",
		];
		for (const query of queries) {
			const a = await fast.drain(query);
			const b = await full.drain(query);
			expect(a.hits.map((hit) => hit.eventId)).toEqual(b.hits.map((hit) => hit.eventId));
		}
		const kelvin = await fast.drain("ok");
		expect(kelvin.hits.length).toBeGreaterThan(0);
		expect((await fast.drain('"say \\"hi\\""')).hits.map((hit) => hit.kind)).toEqual([
			"turn",
			"tool",
			"llm",
		]);
	});

	test("matches what pi's SessionManager writes", async () => {
		const prior = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(root, "agent");
		try {
			const manager = SessionManager.create("/work/a", join(root, "pi"));
			manager.appendMessage({
				role: "user",
				content: 'Fix "Ошибка" in C:\\temp — 🚀',
				timestamp: Date.now(),
			});
			manager.appendMessage({
				role: "user",
				content: "and nothing else",
				timestamp: Date.now(),
			});
			const file = manager.getSessionFile();
			if (!file) throw new Error("expected a persisted session");
			const { ask } = await harness([file]);
			for (const query of ['"\\"ошибка\\""', "c:\\temp", "🚀", "— 🚀"])
				expect((await ask(query)).total.events).toBe(1);
		} finally {
			if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prior;
		}
	});
});

test("snippets are redacted, cut around the match and marked", async () => {
	const builder = new TranscriptBuilder({ id: "secrets", cwd: "/work/a", start: START });
	builder.user("Deploy it");
	const filler = "x ".repeat(400);
	const id = call(
		builder,
		"s1",
		"bash",
		{ command: "deploy --verbose" },
		{
			text: `${filler}token sk-ant-abcdefghijklmnopqrstuvwx in /home/tester/app/deploy.log said DEPLOY failed ${filler}`,
			isError: true,
		},
	);
	const file = writeSession(join(root, "secrets"), "a", builder);
	const { ask } = await harness([file]);
	const answer = await ask("deploy failed");
	const hit = answer.groups[0]?.events.find((candidate) => candidate.eventId === id);
	const snippet = hit?.snippet;
	expect(snippet?.field).toBe("args");
	expect(hit?.fields).toEqual([
		{ field: "args", count: 1 },
		{ field: "error", count: 3 },
	]);
	const deep = await ask('"deploy failed"');
	const error = deep.groups[0]?.events[0]?.snippet;
	expect(error?.field).toBe("error");
	expect(error?.text).not.toContain("sk-ant");
	expect(error?.text).not.toContain("/home/tester");
	expect(error?.text).toContain("[redacted]");
	expect(error?.text).toContain("~/app/deploy.log");
	expect(error?.head).toBe(true);
	expect(error?.tail).toBe(true);
	expect(error?.text.length).toBeLessThanOrEqual(160);
	const [from, to] = error?.marks[0] ?? [0, 0];
	expect(error?.text.slice(from, to)).toBe("DEPLOY failed");
});

test("an argument under a secret-named key is neither matched nor shown", async () => {
	const builder = new TranscriptBuilder({ id: "keyed", cwd: "/work/a", start: START });
	builder.user("Log in");
	call(builder, "k1", "db_connect", { password: "hunter2", user: "hunter-user" }, { text: "ok" });
	call(builder, "k2", "deploy_service", { apiKey: SECRET_ARGS.apiKey }, { text: "deployed" });
	const { ask } = await harness([writeSession(join(root, "keyed"), "a", builder)]);
	expect((await ask("hunter2")).groups).toEqual([]);
	const user = await ask("hunter-user");
	expect(user.groups[0]?.events[0]?.snippet?.text).not.toContain("hunter2");
	expect(user.groups[0]?.events[0]?.label).toBe("hunter-user");
	const deployed = await ask("tool:deploy_service");
	expect(deployed.groups[0]?.events.map((hit) => hit.label)).toEqual([""]);
	expect(JSON.stringify(deployed)).not.toContain(SECRET_ARGS.apiKey);
});

test("a value inside a secret-named container is neither matched, counted nor shown", async () => {
	const file = writeSession(
		join(root, "contained"),
		"a",
		sessionOf("contained", [{ prompt: "Rotate the keys", calls: CONTAINED_SECRET_CALLS }], {
			start: START,
		}),
	);
	const { ask } = await harness([file]);
	for (const value of Object.values(CONTAINED_SECRETS)) {
		const answer = await ask(value, { facets: true });
		expect(answer.groups).toEqual([]);
		expect(answer.total.events).toBe(0);
		expect(answer.facets.tool.values).toEqual([]);
		expect(answer.facets.error).toEqual({ yes: 0, no: 0 });
	}
	const siblings = await ask("tool:vault_write kv/app");
	expect(siblings.total.events).toBe(2);
	const rotation = await ask("rotation");
	expect(rotation.groups[0]?.events.map((hit) => hit.label)).toEqual(["rotation"]);
	const shown = JSON.stringify([siblings, rotation, await ask("tool:store_secrets")]);
	for (const value of Object.values(CONTAINED_SECRETS)) expect(shown).not.toContain(value);
});

describe("jobs", () => {
	/** Fourteen sessions with five failing lint runs each, one with eight. */
	function many(dir: string): string[] {
		return Array.from({ length: 14 }, (_, at) => {
			const builder = new TranscriptBuilder({
				id: `many-${String(at).padStart(2, "0")}`,
				cwd: "/work/a",
				start: START + at * DAY,
			});
			builder.user("Keep linting");
			const runs = at === 13 ? 8 : 5;
			for (let run = 0; run < runs; run++)
				call(
					builder,
					`m${at}-${run}`,
					"bash",
					{ command: "bun run lint" },
					{
						text: LINT_ERROR,
						isError: true,
					},
				);
			return writeSession(dir, `s${at}`, builder);
		});
	}

	test("a page stops early, next continues it and a session's more shows the rest", async () => {
		const files = many(join(root, "many"));
		const { ask } = await harness(files);
		const first = await ask("lint error:yes");
		expect(first.status).toBe("more");
		expect(first.groups).toHaveLength(10);
		expect(first.groups.map((group) => group.matches)).toEqual([8, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
		expect(first.groups[0]?.shown).toBe(5);
		expect(first.total.exact).toBe(false);
		expect(first.total.events).toBe(53);
		expect(first.next).toBe(`${first.seq}:1`);
		const more = first.groups[0]?.more ?? "";
		const rest = await ask("lint error:yes", { seq: first.seq, cursor: more });
		expect(rest.groups).toHaveLength(1);
		expect(rest.groups[0]).toMatchObject({ matches: 8, shown: 8, more: null });
		expect(rest.groups[0]?.events).toHaveLength(3);
		expect(rest.status).toBe("more");
		const second = await ask("lint error:yes", { seq: first.seq, cursor: first.next ?? "" });
		expect(second.status).toBe("done");
		expect(second.groups).toHaveLength(4);
		expect(second.total).toEqual({ events: 73, sessions: 14, exact: true });
		expect(second.next).toBeNull();
		const stale = await ask("lint error:yes", { seq: first.seq, cursor: first.next ?? "" });
		expect(stale.status).toBe("expired");
	});

	test("filters alone count every session at once", async () => {
		const files = many(join(root, "many-filters"));
		const { ask } = await harness(files);
		const answer = await ask("tool:bash");
		expect(answer.status).toBe("more");
		expect(answer.total).toEqual({ events: 73, sessions: 14, exact: true });
		expect(answer.facets.tool.values).toEqual([{ value: "bash", count: 73 }]);
	});

	test("answers paged by a tiny time budget add up to one answer", async () => {
		const files = many(join(root, "many-budget"));
		const whole = await (await harness(files)).drain("lint");
		const sliced = await (await harness(files, { budgetMs: 0, sliceMs: 0 })).drain("lint");
		expect(sliced.answers.length).toBeGreaterThan(whole.answers.length);
		expect(sliced.answers.some((answer) => answer.status === "scanning")).toBe(true);
		expect(sliced.hits.map((hit) => hit.eventId)).toEqual(whole.hits.map((hit) => hit.eventId));
		expect(sliced.hits).toHaveLength(87);
		expect(sliced.answers.at(-1)?.total).toEqual(whole.answers.at(-1)?.total);
		const scanning = sliced.answers.find((answer) => answer.status === "scanning");
		expect(scanning?.total.exact).toBe(false);
	});

	test("a newer query cancels the scan of the older one, and the older one stays superseded", async () => {
		const files = many(join(root, "many-cancel"));
		const { ask } = await harness(files, { sliceMs: 0 });
		const older = ask("lint", { seq: 1 });
		const newer = ask("tool:bash", { seq: 2 });
		expect((await older).status).toBe("superseded");
		expect((await newer).status).toBe("more");
		expect((await ask("lint", { seq: 1 })).status).toBe("superseded");
		expect((await ask("lint", { seq: 2, cursor: "1:1" })).status).toBe("expired");
		const other = await ask("lint", { seq: 1, client: "other-panel" });
		expect(other.status).toBe("more");
	});

	test("a search started while the index is cold reads the sessions indexed after it", async () => {
		const dir = join(root, "late");
		const session = (id: string, at: number, text: string) => {
			const builder = new TranscriptBuilder({ id, cwd: "/work/a", start: START + at * DAY });
			builder.user(text);
			builder.assistant({ text: "Done." });
			return writeSession(dir, id, builder);
		};
		const files = [
			session("1-early", 0, "deploy the API"),
			session("2-late", 2, "deploy the worker"),
			session("3-later", 1, "write the docs"),
		];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const index = new SessionIndex({
			sessionFiles: async () => files,
			childTranscriptDirs: async ({ sessionId }) => {
				if (sessionId === "1-early") await gate;
				return [];
			},
		});
		const cold = await index.ensureFresh(50);
		expect(cold.phase).toBe("cold");
		expect(index.summaries().map((summary) => summary.sessionId)).toEqual(["1-early"]);
		const { input } = await statsOver(files, { index });
		const jobs = new SearchJobs({ redactor: createRedactor("/home/tester") });
		const params = { scope: { kind: "all" as const }, client: "panel", seq: 1, query: "deploy" };
		const first = await jobs.run(input, cold, params);
		expect(first.status).toBe("scanning");
		expect(first.total).toEqual({ events: 1, sessions: 1, exact: false });
		expect(first.next).not.toBeNull();
		const waiting = await jobs.run(input, cold, { ...params, cursor: first.next ?? "" });
		expect(waiting).toMatchObject({ status: "scanning", groups: [] });
		release();
		const ready = await index.ensureFresh(10_000);
		expect(ready.phase).toBe("ready");
		const last = await jobs.run(input, ready, { ...params, cursor: waiting.next ?? "" });
		expect(last.status).toBe("done");
		expect(last.total).toEqual({ events: 2, sessions: 2, exact: true });
		expect(last.scanned).toEqual({ sessions: 3, total: 3 });
		const groups = [first, last].flatMap((answer) =>
			answer.groups.map((group) => answer.sessions[group.session]?.sessionId),
		);
		expect(groups).toEqual(["1-early", "2-late"]);
	});
});
