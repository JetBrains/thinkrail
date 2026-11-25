import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runDetails, TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import { CACHE_VERSION, fileSummaryCache } from "./cache.ts";
import { listSessionFiles } from "./discovery.ts";
import * as lines from "./lines.ts";
import { SessionIndex, type SessionIndexOptions } from "./sessionIndex.ts";
import { PARSER_VERSION, summarizeSessionText } from "./summary.ts";

const base = tempDir("index");
let root: string;
let sessions: string;
let scans: ReturnType<typeof spyOn<typeof lines, "scanFile">>;

beforeEach(() => {
	root = join(base, crypto.randomUUID());
	sessions = join(root, "sessions");
	mkdirSync(sessions, { recursive: true });
	scans = spyOn(lines, "scanFile");
});

afterEach(() => scans.mockRestore());
afterAll(() => rmSync(base, { recursive: true, force: true }));

function sessionScans(): { path: string; from: number }[] {
	return scans.mock.calls
		.filter(([path]) => path.startsWith(sessions) || path.startsWith(join(root, "children")))
		.map(([path, from]) => ({ path, from }));
}

function indexOver(options: Partial<SessionIndexOptions> = {}): SessionIndex {
	return new SessionIndex({
		sessionFiles: () => listSessionFiles(sessions),
		childTranscriptDirs: async () => [],
		revalidateMs: 0,
		...options,
	});
}

async function settle(index: SessionIndex) {
	const state = await index.ensureFresh(10_000);
	expect(state.phase).toBe("ready");
	return state;
}

function session(id: string, prompt = "Fix the parser"): TranscriptBuilder {
	const builder = new TranscriptBuilder({ id, cwd: `/work/${id}` });
	builder.user(prompt);
	builder.assistant({ text: "On it.", usage: usage(10, 0.1) });
	return builder;
}

function expectFullParse(index: SessionIndex, file: string) {
	const summary = index.summaries().find((candidate) => candidate.file === file);
	expect(summary).toEqual(summarizeSessionText(file, readFileSync(file, "utf8")) ?? undefined);
}

describe("revalidation", () => {
	test("a cold query answers within its budget and the index becomes ready", async () => {
		writeSession(sessions, "a", session("s1"));
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const index = indexOver({
			sessionFiles: async () => {
				await gate;
				return listSessionFiles(sessions);
			},
		});
		expect(await index.ensureFresh(5)).toEqual({ phase: "cold", indexed: 0, total: null });
		expect(index.summaries()).toEqual([]);
		release();
		expect(await settle(index)).toEqual({ phase: "ready", indexed: 1, total: 1 });
		expect(index.summaries().map((summary) => summary.sessionId)).toEqual(["s1"]);
	});

	test("an unchanged file is not parsed again", async () => {
		writeSession(sessions, "a", session("s1"));
		writeSession(sessions, "b", session("s2"));
		const index = indexOver();
		await settle(index);
		expect(sessionScans()).toHaveLength(2);
		await settle(index);
		await settle(index);
		expect(sessionScans()).toHaveLength(2);
	});

	test("appends parse from where the last parse stopped and equal a full parse", async () => {
		const builder = session("s1");
		const file = writeSession(sessions, "a", builder);
		const index = indexOver();
		await settle(index);
		for (let step = 0; step < 5; step += 1) {
			const before = statSync(file).size;
			const grown = new TranscriptBuilder({ id: "s1", cwd: "/work/s1" });
			grown.user(`step ${step}`);
			grown.assistant({ toolCalls: [{ id: `c${step}`, name: "bash" }], usage: usage(step, 0.01) });
			grown.toolResult({ toolCallId: `c${step}`, toolName: "bash", isError: step % 2 === 0 });
			appendFileSync(file, grown.text().slice(grown.text().indexOf("\n") + 1));
			await settle(index);
			expect(sessionScans().at(-1)).toEqual({ path: file, from: before });
		}
		expectFullParse(index, file);
		expect(index.summaries()[0]?.counts).toMatchObject({ userMessages: 6, toolErrors: 3 });
	});

	test("a live session's torn last line is counted once it is complete", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		const line = JSON.stringify({
			type: "message",
			id: "late",
			parentId: null,
			timestamp: "2026-11-01T10:05:00.000Z",
			message: { role: "user", content: "late prompt", timestamp: 1 },
		});
		appendFileSync(file, line.slice(0, 20));
		const index = indexOver();
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(1);
		appendFileSync(file, `${line.slice(20)}\n`);
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(2);
		expectFullParse(index, file);
	});

	test("a complete unterminated last line counts now and is not counted twice later", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		const extra = session("s1").text().split("\n")[1] ?? "";
		appendFileSync(file, extra);
		const index = indexOver();
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(2);
		appendFileSync(file, `\n${extra}\n`);
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(3);
		expectFullParse(index, file);
	});

	test("a truncated file is parsed again from the start", async () => {
		const builder = session("s1");
		const file = writeSession(sessions, "a", builder);
		const index = indexOver();
		await settle(index);
		const firstLine = builder.text().indexOf("\n") + 1;
		truncateSync(file, firstLine + (builder.text().slice(firstLine).indexOf("\n") + 1));
		await settle(index);
		expect(sessionScans().at(-1)).toEqual({ path: file, from: 0 });
		expect(index.summaries()[0]?.counts.assistantMessages).toBe(0);
		expectFullParse(index, file);
	});

	test("a same-size rewrite is reparsed when its mtime moves and kept while it does not", async () => {
		const write = (title: string) => {
			const builder = session("s1");
			builder.sessionInfo(title);
			return writeSession(sessions, "a", builder);
		};
		const file = write("AAAA");
		const seconds = 1_800_000_000;
		utimesSync(file, seconds, seconds);
		const index = indexOver();
		await settle(index);
		write("BBBB");
		utimesSync(file, seconds, seconds);
		await settle(index);
		expect(sessionScans()).toHaveLength(1);
		expect(index.summaries()[0]?.title).toBe("AAAA");
		utimesSync(file, seconds, seconds + 5);
		await settle(index);
		expect(sessionScans().at(-1)).toEqual({ path: file, from: 0 });
		expect(index.summaries()[0]?.title).toBe("BBBB");
	});

	test("a grown file whose consumed tail changed is parsed again from the start", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		const index = indexOver();
		await settle(index);
		const text = readFileSync(file, "utf8").replace("On it.", "Nope!!");
		writeFileSync(file, `${text}${session("s1").text().split("\n")[1]}\n`);
		await settle(index);
		expect(sessionScans().at(-1)).toEqual({ path: file, from: 0 });
		expectFullParse(index, file);
	});

	test("a migrated legacy file is parsed whole whenever it changes", async () => {
		const builder = new TranscriptBuilder({ id: "old", version: 2 });
		builder.user("legacy");
		const file = writeSession(sessions, "a", builder);
		const index = indexOver();
		await settle(index);
		appendFileSync(file, `${session("old").text().split("\n")[2]}\n`);
		await settle(index);
		expect(sessionScans().map(({ from }) => from)).toEqual([0, 0]);
		expectFullParse(index, file);
	});

	test("vanished, invalid and unreadable files are dropped without failing the index", async () => {
		const keep = writeSession(sessions, "a", session("s1"));
		const gone = writeSession(sessions, "b", session("s2"));
		writeFileSync(join(sessions, "a", "notes.jsonl"), '{"type":"note"}\n');
		mkdirSync(join(sessions, "a", "folder.jsonl"));
		const errors: unknown[] = [];
		const index = indexOver({ onError: (error) => errors.push(error) });
		await settle(index);
		expect(index.summaries().map((summary) => summary.file)).toEqual([keep, gone]);
		rmSync(gone);
		await settle(index);
		expect(index.summaries().map((summary) => summary.file)).toEqual([keep]);
		expect(errors).toEqual([]);
	});

	test("a failing file listing reaches onError and the query still resolves", async () => {
		const errors: unknown[] = [];
		const index = indexOver({
			sessionFiles: async () => {
				throw new Error("listing failed");
			},
			onError: (error) => errors.push(error),
		});
		expect((await index.ensureFresh(10_000)).phase).toBe("ready");
		expect(errors).toHaveLength(1);
	});

	test("revalidation is throttled by revalidateMs", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		let now = 0;
		const index = indexOver({ revalidateMs: 2000, now: () => now });
		await settle(index);
		appendFileSync(file, `${session("s1").text().split("\n")[1]}\n`);
		now = 1999;
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(1);
		now = 2000;
		await settle(index);
		expect(index.summaries()[0]?.counts.userMessages).toBe(2);
	});

	test("`fresh` revalidates at once, or right after the running revalidation", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		let now = 0;
		let listings = 0;
		let release = () => {};
		let gate: Promise<void> | null = null;
		const index = indexOver({
			revalidateMs: 2000,
			now: () => now,
			sessionFiles: async () => {
				listings += 1;
				if (gate) await gate;
				return listSessionFiles(sessions);
			},
		});
		await settle(index);
		appendFileSync(file, `${session("s1").text().split("\n")[1]}\n`);
		now = 10;
		expect((await index.ensureFresh(10_000, { fresh: true })).phase).toBe("ready");
		expect(listings).toBe(2);
		expect(index.summaries()[0]?.counts.userMessages).toBe(2);
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		now = 5000;
		await index.ensureFresh(0);
		appendFileSync(file, `${session("s1").text().split("\n")[1]}\n`);
		const forced = index.ensureFresh(10_000, { fresh: true });
		gate = null;
		release();
		expect((await forced).phase).toBe("ready");
		expect(listings).toBe(4);
		expect(index.summaries()[0]?.counts.userMessages).toBe(3);
	});

	test("the throttle counts from the end of the last refresh, so a slow one is not restarted by the next poll", async () => {
		writeSession(sessions, "a", session("s1"));
		let now = 0;
		let listings = 0;
		const index = indexOver({
			revalidateMs: 2000,
			now: () => now,
			sessionFiles: () => {
				listings += 1;
				now += 5000;
				return listSessionFiles(sessions);
			},
		});
		await settle(index);
		now += 1999;
		await settle(index);
		expect(listings).toBe(1);
		now += 1;
		await settle(index);
		expect(listings).toBe(2);
	});
});

describe("subagent transcripts", () => {
	test("child transcripts come from the injected locator and follow the same rules", async () => {
		const parent = session("parent");
		parent.assistant({ toolCalls: [{ id: "spawn", name: "Agent" }] });
		parent.toolResult({
			toolCallId: "spawn",
			toolName: "Agent",
			details: runDetails("child", "running", { tokens: 0, cost: 0 }),
		});
		writeSession(sessions, "a", parent);
		const childDir = join(root, "children", "parent");
		const child = new TranscriptBuilder({ id: "child" });
		child.user("Investigate");
		const childFile = writeSession(join(root, "children"), "parent", child);
		const asked: { sessionId: string; cwd: string }[] = [];
		const index = indexOver({
			childTranscriptDirs: async (owner) => {
				asked.push(owner);
				return owner.sessionId === "parent" ? [childDir] : [];
			},
		});
		await settle(index);
		expect(asked).toEqual([{ sessionId: "parent", cwd: "/work/parent" }]);
		expect(index.summaries().map((summary) => summary.sessionId)).toEqual(["parent"]);
		expect(index.childFiles("parent")).toEqual([childFile]);
		expect(index.childSummary(childFile)?.counts.assistantMessages).toBe(0);

		const more = new TranscriptBuilder({ id: "child" });
		more.assistant({ usage: usage(5, 0.2) });
		appendFileSync(childFile, more.text().slice(more.text().indexOf("\n") + 1));
		await settle(index);
		expect(sessionScans().at(-1)?.path).toBe(childFile);
		expect(sessionScans().at(-1)?.from).toBeGreaterThan(0);
		expect(index.childSummary(childFile)?.spend.cost).toBeCloseTo(0.2, 12);
		expect(asked).toHaveLength(1);

		rmSync(childFile);
		await settle(index);
		expect(index.childFiles("parent")).toEqual([]);
		expect(index.childSummary(childFile)).toBeUndefined();
	});
});

describe("the summary cache", () => {
	const PROMPT = "Refactor the zebra-striped quokka renderer";
	const REPLY = "Quokka renderer refactored with zebra stripes";
	const TOOL_OUTPUT = "secret-tool-output-7731";

	function richSession(): TranscriptBuilder {
		const builder = new TranscriptBuilder({ id: "rich", cwd: "/work/rich" });
		builder.user(PROMPT);
		builder.sessionInfo("Quokka work");
		builder.assistant({ text: REPLY, toolCalls: [{ id: "c1", name: "bash" }] });
		builder.toolResult({ toolCallId: "c1", toolName: "bash", text: TOOL_OUTPUT });
		builder.customMessage("note", { text: "custom detail text 5521" }, "custom body text 9912");
		return builder;
	}

	test("holds no message text, and a warm start reuses it without parsing", async () => {
		writeSession(sessions, "a", richSession());
		const dataDir = join(root, "data");
		const first = indexOver({ cache: fileSummaryCache(dataDir) });
		await settle(first);
		const cacheFile = join(dataDir, "summaries.v1.jsonl");
		const stored = readFileSync(cacheFile, "utf8");
		for (const text of [PROMPT, REPLY, TOOL_OUTPUT, "custom detail text", "custom body text"])
			expect(stored).not.toContain(text);
		expect(stored).toContain("Quokka work");

		scans.mockClear();
		const warm = indexOver({ cache: fileSummaryCache(dataDir) });
		await settle(warm);
		expect(sessionScans()).toEqual([]);
		expect(warm.summaries()).toEqual(first.summaries());
		expect(await warm.firstPrompt("rich")).toBe(PROMPT);
		expect(readFileSync(cacheFile, "utf8")).toBe(stored);
	});

	test("a cache from another parser version or a corrupt cache is ignored", async () => {
		const file = writeSession(sessions, "a", session("s1"));
		const dataDir = join(root, "data");
		await settle(indexOver({ cache: fileSummaryCache(dataDir) }));
		const cacheFile = join(dataDir, "summaries.v1.jsonl");
		const [header = "", ...records] = readFileSync(cacheFile, "utf8").trimEnd().split("\n");
		const forged = records.map((line) => line.replaceAll('"title":null', '"title":"forged"'));
		const write = (parserVersion: number) =>
			writeFileSync(
				cacheFile,
				`${[JSON.stringify({ ...JSON.parse(header), parserVersion }), ...forged].join("\n")}\n`,
			);

		write(PARSER_VERSION);
		const trusting = indexOver({ cache: fileSummaryCache(dataDir) });
		await settle(trusting);
		expect(trusting.summaries()[0]?.title).toBe("forged");

		write(PARSER_VERSION + 1);
		const fresh = indexOver({ cache: fileSummaryCache(dataDir) });
		await settle(fresh);
		expect(fresh.summaries()[0]?.title).toBeNull();
		expectFullParse(fresh, file);

		writeFileSync(cacheFile, "{not json\n");
		const recovered = indexOver({ cache: fileSummaryCache(dataDir) });
		await settle(recovered);
		expectFullParse(recovered, file);
		expect(JSON.parse(readFileSync(cacheFile, "utf8").split("\n")[0] ?? "")).toEqual({
			cacheVersion: CACHE_VERSION,
			parserVersion: PARSER_VERSION,
		});
	});

	test("a failing cache never fails the index", async () => {
		writeSession(sessions, "a", session("s1"));
		const errors: unknown[] = [];
		const index = indexOver({
			cache: {
				load: async () => {
					throw new Error("load");
				},
				save: async () => {
					throw new Error("save");
				},
			},
			onError: (error) => errors.push(error),
		});
		await settle(index);
		expect(index.summaries()).toHaveLength(1);
		expect(errors.map((error) => (error as Error).message)).toEqual(["load", "save"]);
	});
});
