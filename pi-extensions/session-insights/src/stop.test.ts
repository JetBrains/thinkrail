import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TranscriptBuilder, tempDir, usage, writeSession } from "../test/builders.ts";
import { statsOver } from "../test/stats.ts";
import { fileSummaryCache } from "./cache.ts";
import type { DigestProgress, IndexState } from "./core.ts";
import { DigestStore, digestOf } from "./digest.ts";
import { listSessionFiles } from "./discovery.ts";
import { SearchJobs } from "./search.ts";
import { SessionIndex } from "./sessionIndex.ts";
import type { SessionSummary } from "./summary.ts";
import { TraceStore } from "./traceStore.ts";

const root = tempDir("stop");
afterAll(() => rmSync(root, { recursive: true, force: true }));

function sessions(dir: string, count: number): string[] {
	return Array.from({ length: count }, (_, n) => {
		const builder = new TranscriptBuilder({ id: `s${n}`, cwd: `/work/a${n}` });
		builder.user(`Task ${n}`);
		builder.assistant({ text: "Done.", usage: usage(10, 0.1) });
		return writeSession(dir, `f${n}`, builder);
	});
}

const READY: IndexState = { phase: "ready", indexed: 3, total: 3 };

describe("an aborted signal stops the work it governs", () => {
	test("the index stops at its next yield, writes no cache and never revalidates again", async () => {
		const dir = join(root, "index", "sessions");
		sessions(dir, 3);
		const dataDir = join(root, "index", "data");
		const controller = new AbortController();
		const asked: string[] = [];
		const errors: unknown[] = [];
		let listings = 0;
		const index = new SessionIndex({
			sessionFiles: () => {
				listings += 1;
				return listSessionFiles(dir);
			},
			childTranscriptDirs: async ({ sessionId }) => {
				asked.push(sessionId);
				controller.abort(new Error("switched off"));
				return [];
			},
			cache: fileSummaryCache(dataDir),
			revalidateMs: 0,
			sliceMs: 0,
			onError: (error) => errors.push(error),
			signal: controller.signal,
		});
		await index.ensureFresh(10_000);
		expect(asked).toEqual(["s0"]);
		expect(existsSync(join(dataDir, "summaries.v1.jsonl"))).toBe(false);
		expect(errors).toEqual([]);

		await index.ensureFresh(10_000, { fresh: true });
		expect(listings).toBe(1);
		expect(asked).toEqual(["s0"]);
		expect(existsSync(join(dataDir, "summaries.v1.jsonl"))).toBe(false);
	});

	test("a cache save aborted part-way leaves the file it would replace as it was", async () => {
		const dataDir = join(root, "cache");
		const cache = fileSummaryCache(dataDir);
		await cache.save({ cacheVersion: 1, parserVersion: 1, files: { a: { kept: true } } });
		const before = readFileSync(join(dataDir, "summaries.v1.jsonl"), "utf8");
		const controller = new AbortController();
		const files = Object.fromEntries(
			Array.from({ length: 20_000 }, (_, n) => [`f${n}`, { n }] as const),
		);
		const saving = cache.save({ cacheVersion: 1, parserVersion: 1, files }, controller.signal);
		controller.abort(new Error("switched off"));
		await expect(saving).rejects.toThrow("switched off");
		expect(readFileSync(join(dataDir, "summaries.v1.jsonl"), "utf8")).toBe(before);
	});

	test("the digest store records no build that ends after the abort, drops its digests and queue and answers its waiters", async () => {
		const dir = join(root, "digests", "sessions");
		const files = sessions(dir, 3);
		const index = new SessionIndex({
			sessionFiles: async () => files,
			childTranscriptDirs: async () => [],
		});
		await index.ensureFresh(10_000);
		const summaries = [...index.summaries()];
		const traces = new TraceStore();
		const controller = new AbortController();
		const built: string[] = [];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const digests = new DigestStore(
			async (summary: SessionSummary) => {
				built.push(summary.sessionId);
				if (built.length === 2) await gate;
				const trace = await traces.peek(summary.file);
				return trace ? digestOf(trace, summary) : null;
			},
			undefined,
			{ signal: controller.signal },
		);
		const [first, second, third] = summaries;
		if (!first || !second || !third) throw new Error("three sessions were indexed");
		expect(await digests.need(first)).not.toBeNull();
		const progress: Promise<DigestProgress> = digests.ensure([second, third], 10_000);
		const waiting = digests.need(third);
		for (let tick = 0; built.length < 2 && tick < 100; tick++) await Bun.sleep(1);
		expect(built).toEqual([first.sessionId, second.sessionId]);

		controller.abort(new Error("switched off"));
		expect(await waiting).toBeNull();
		release();
		expect(await progress).toEqual({ ready: 0, total: 2, stale: 0 });
		await Bun.sleep(5);
		expect(built).toEqual([first.sessionId, second.sessionId]);
		expect(digests.get(first)).toBeUndefined();
		expect(digests.get(second)).toBeUndefined();
		expect(await digests.ensure([third], 0)).toEqual({ ready: 0, total: 1, stale: 0 });
		expect(await digests.need(third)).toBeNull();
		expect(built).toHaveLength(2);
	});

	test("the trace store stops a build at its next yield and keeps nothing of it", async () => {
		const [file] = sessions(join(root, "traces", "sessions"), 1);
		if (!file) throw new Error("one session was written");
		const controller = new AbortController();
		const traces = new TraceStore({ sliceMs: 0, signal: controller.signal });
		const building = traces.trace(file);
		controller.abort(new Error("switched off"));
		expect(await building).toBeNull();
		expect(await traces.trace(file)).toBeNull();
		expect(await new TraceStore().trace(file)).not.toBeNull();
	});

	test("search cancels its jobs and answers later requests as superseded", async () => {
		const files = sessions(join(root, "search", "sessions"), 3);
		const { input } = await statsOver(files);
		const controller = new AbortController();
		const jobs = new SearchJobs({ signal: controller.signal });
		const ask = (seq: number) =>
			jobs.run(input, READY, { scope: { kind: "all" }, client: "panel", seq, query: "Task" });
		expect((await ask(1)).status).toBe("done");
		controller.abort(new Error("switched off"));
		const after = await ask(2);
		expect(after.status).toBe("superseded");
		expect(after.groups).toEqual([]);
	});
});
