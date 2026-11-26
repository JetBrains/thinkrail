import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { TranscriptBuilder, tempDir } from "../test/builders.ts";
import { type ByteRange, scanBytes, scanFile, sliceYielder, type Yielder } from "./lines.ts";

const FIXTURE = join(
	import.meta.dir,
	"../../../e2e/workflows/fixtures/brainstorming-mid-flow/session.jsonl",
);
const root = tempDir("lines");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const never: Yielder = { due: () => false, pause: async () => {} };

function collect(text: string) {
	const entries: { entry: unknown; range: ByteRange }[] = [];
	const result = scanBytes(new TextEncoder().encode(text), (entry, range) =>
		entries.push({ entry, range }),
	);
	return { entries, ...result };
}

function piEntries(text: string): unknown[] {
	return parseSessionEntries(text);
}

function messy(): string {
	const builder = new TranscriptBuilder();
	builder.user("héllo ✓ 😀 — first prompt");
	builder.assistant({ text: "ünïcode reply" });
	return `${builder.text()}\n   \nnot json at all\n{"type":"custom","id":"x1","parentId":null,"timestamp":"2026-11-01T10:00:09.000Z","customType":"a"}\r\n\n`;
}

describe("the streaming line parse mirrors pi's parseSessionEntries", () => {
	const torn = `${messy()}{"type":"message","id":"torn","mess`;
	const unterminated = `${messy()}{"type":"custom","id":"last","parentId":null,"timestamp":"2026-11-01T10:00:10.000Z","customType":"b"}`;

	test.each([
		["the e2e fixture", readFileSync(FIXTURE, "utf8")],
		["blank, unparseable and CRLF lines", messy()],
		["a torn last line", torn],
		["a complete last line without a newline", unterminated],
		["an empty file", ""],
	])("%s", (_name, text) => {
		const { entries, tail } = collect(text);
		expect([...entries.map(({ entry }) => entry), ...(tail ? [tail.entry] : [])]).toEqual(
			piEntries(text),
		);
	});

	test("ranges are exact byte offsets of each line", () => {
		const text = messy();
		const bytes = new TextEncoder().encode(text);
		const { entries } = collect(text);
		for (const { entry, range } of entries) {
			const line = new TextDecoder().decode(
				bytes.subarray(range.offset, range.offset + range.length),
			);
			expect(JSON.parse(line)).toEqual(entry);
		}
	});

	test("consumed stops after the last newline; a torn last line is left for later", () => {
		const text = `${messy()}{"type":"message","id":"torn"`;
		const { consumed, tail } = collect(text);
		expect(consumed).toBe(new TextEncoder().encode(messy()).length);
		expect(tail).toBeNull();
	});

	test("a complete unterminated last line is reported as the tail, not consumed", () => {
		const prefix = messy();
		const last = { type: "custom", id: "last", customType: "b" };
		const { consumed, tail } = collect(`${prefix}${JSON.stringify(last)}`);
		const offset = new TextEncoder().encode(prefix).length;
		expect(consumed).toBe(offset);
		expect(tail).toEqual({ entry: last, range: { offset, length: JSON.stringify(last).length } });
	});
});

describe("scanFile", () => {
	test("matches scanBytes across chunk boundaries and from an offset", async () => {
		const builder = new TranscriptBuilder();
		builder.user("x".repeat(1_600_000));
		for (let index = 0; index < 50; index += 1) builder.assistant({ text: `reply ${index} ✓` });
		const text = `${builder.text()}{"torn":`;
		const file = join(root, "chunks.jsonl");
		writeFileSync(file, text);
		const bytes = new TextEncoder().encode(text);
		const whole = collect(text);
		const streamed: { entry: unknown; range: ByteRange }[] = [];
		const result = await scanFile(
			file,
			0,
			bytes.length,
			(entry, range) => streamed.push({ entry, range }),
			never,
		);
		expect(streamed).toEqual(whole.entries);
		expect(result).toEqual({ consumed: whole.consumed, tail: whole.tail });

		const from = whole.entries[10]?.range.offset ?? 0;
		const rest: { entry: unknown; range: ByteRange }[] = [];
		await scanFile(file, from, bytes.length, (entry, range) => rest.push({ entry, range }), never);
		expect(rest).toEqual(whole.entries.slice(10));
	});

	test("yields to the event loop on a 20k-line file", async () => {
		const builder = new TranscriptBuilder();
		for (let index = 0; index < 20_000; index += 1) builder.user(`prompt ${index}`);
		const text = builder.text();
		const file = join(root, "many.jsonl");
		writeFileSync(file, text);
		let tick = 0;
		const immediates = spyOn(globalThis, "setImmediate");
		try {
			let count = 0;
			await scanFile(
				file,
				0,
				Buffer.byteLength(text),
				() => {
					count += 1;
				},
				sliceYielder(8, () => tick++),
			);
			expect(count).toBe(20_001);
			expect(immediates.mock.calls.length).toBeGreaterThan(1000);
		} finally {
			immediates.mockRestore();
		}
	});
});
