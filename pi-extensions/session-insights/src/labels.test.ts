import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/builders.ts";
import { LABEL_RULES } from "./core.ts";
import {
	LABELS_DOCUMENT,
	labelLookup,
	labelsView,
	parseLabelsDocument,
	parseLabelsGetParams,
	parseLabelsSetParams,
	readLabels,
	setSessionLabels,
} from "./labels.ts";
import { JsonStore } from "./store.ts";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function store(): { store: JsonStore; dir: string } {
	const dir = tempDir("labels");
	roots.push(dir);
	return { store: new JsonStore(dir), dir };
}

describe("labels.set params", () => {
	test("labels are trimmed, collapsed, unique case-insensitively and sorted; an empty note is none", () => {
		expect(
			parseLabelsSetParams({
				sessionId: "s1",
				labels: ["  good  run ", "Bad", "good run", "bad"],
				note: "  \r\n ",
			}),
		).toEqual({ sessionId: "s1", labels: ["Bad", "good run"], note: null });
	});

	test("notes keep their line breaks and lose control characters", () => {
		expect(parseLabelsSetParams({ sessionId: "s1", labels: [], note: "a\r\nb\u0007c" }).note).toBe(
			"a\nbc",
		);
	});

	test("limits and shapes reject before anything is written", () => {
		const long = "x".repeat(LABEL_RULES.labelChars + 1);
		const many = Array.from({ length: LABEL_RULES.labelsPerSession + 1 }, (_, i) => `l${i}`);
		for (const params of [
			null,
			{ labels: [], note: null },
			{ sessionId: "", labels: [], note: null },
			{ sessionId: "s".repeat(201), labels: [], note: null },
			{ sessionId: "s1", labels: "good", note: null },
			{ sessionId: "s1", labels: [long], note: null },
			{ sessionId: "s1", labels: ["   "], note: null },
			{ sessionId: "s1", labels: many, note: null },
			{ sessionId: "s1", labels: [1], note: null },
			{ sessionId: "s1", labels: [], note: 3 },
			{ sessionId: "s1", labels: [], note: "n".repeat(LABEL_RULES.noteChars + 1) },
		])
			expect(() => parseLabelsSetParams(params)).toThrow("Invalid labels.set params");
	});

	test("labels.get takes at most the notes limit of valid ids", () => {
		expect(parseLabelsGetParams(undefined)).toEqual({});
		expect(parseLabelsGetParams({ sessionIds: ["a", "b"] })).toEqual({ sessionIds: ["a", "b"] });
		expect(() => parseLabelsGetParams({ sessionIds: [""] })).toThrow();
		expect(() =>
			parseLabelsGetParams({
				sessionIds: Array.from({ length: LABEL_RULES.notesPerRequest + 1 }, (_, i) => `s${i}`),
			}),
		).toThrow();
	});
});

describe("the labels store", () => {
	test("writes nothing once its signal aborts, even mid-update, and keeps the previous document", async () => {
		const dir = tempDir("labels-abort");
		roots.push(dir);
		const controller = new AbortController();
		const reason = new Error("switched off");
		const labels = new JsonStore(dir, { signal: controller.signal });
		await setSessionLabels(
			labels,
			parseLabelsSetParams({ sessionId: "s1", labels: ["good"], note: null }),
		);
		const before = readFileSync(join(dir, LABELS_DOCUMENT), "utf8");
		const midway = labels.update(
			LABELS_DOCUMENT,
			parseLabelsDocument,
			(current) => {
				controller.abort(reason);
				return { ...current, sessions: new Map() };
			},
			() => ({ version: 1, sessions: {} }),
		);
		await expect(midway).rejects.toBe(reason);
		await expect(
			setSessionLabels(
				labels,
				parseLabelsSetParams({ sessionId: "s2", labels: ["x"], note: null }),
			),
		).rejects.toBe(reason);
		expect(readdirSync(dir)).toEqual([LABELS_DOCUMENT]);
		expect(readFileSync(join(dir, LABELS_DOCUMENT), "utf8")).toBe(before);
		expect(labelLookup(await readLabels(labels))("s1")).toEqual(["good"]);
	});

	test("a set round-trips through the store, with the vocabulary and notes only for asked sessions", async () => {
		const { store: labels, dir } = store();
		const first = await setSessionLabels(
			labels,
			parseLabelsSetParams({ sessionId: "s1", labels: ["good"], note: "Fast and clean." }),
		);
		expect(first).toEqual({
			ok: true,
			session: { sessionId: "s1", labels: ["good"], note: "Fast and clean.", noted: true },
			vocabulary: [{ label: "good", sessions: 1 }],
		});
		await setSessionLabels(
			labels,
			parseLabelsSetParams({ sessionId: "s2", labels: ["Good", "slow"], note: null }),
		);
		const document = await readLabels(labels);
		expect(labelsView(document, {})).toEqual({
			sessions: [
				{ sessionId: "s1", labels: ["good"], note: null, noted: true },
				{ sessionId: "s2", labels: ["Good", "slow"], note: null, noted: false },
			],
			vocabulary: [
				{ label: "good", sessions: 2 },
				{ label: "slow", sessions: 1 },
			],
		});
		expect(labelsView(document, { sessionIds: ["s1"] }).sessions[0]?.note).toBe("Fast and clean.");
		expect(labelLookup(document)("s2")).toEqual(["Good", "slow"]);
		expect(labelLookup(document)("nobody")).toEqual([]);
		const written = JSON.parse(readFileSync(join(dir, LABELS_DOCUMENT), "utf8"));
		expect(written).toEqual({
			version: 1,
			sessions: {
				s1: { labels: ["good"], note: "Fast and clean." },
				s2: { labels: ["Good", "slow"] },
			},
		});
	});

	test("no labels and no note forget the session", async () => {
		const { store: labels } = store();
		await setSessionLabels(
			labels,
			parseLabelsSetParams({ sessionId: "s1", labels: ["x"], note: null }),
		);
		await setSessionLabels(labels, parseLabelsSetParams({ sessionId: "s1", labels: [], note: "" }));
		expect((await readLabels(labels)).sessions.size).toBe(0);
	});

	test("a new session past the limit is refused and nothing changes; an existing one still updates", async () => {
		const { store: labels, dir } = store();
		const sessions: Record<string, { labels: string[] }> = {};
		for (let i = 0; i < LABEL_RULES.sessions; i++) sessions[`s${i}`] = { labels: ["x"] };
		writeFileSync(join(dir, LABELS_DOCUMENT), JSON.stringify({ version: 1, sessions }));
		const before = readFileSync(join(dir, LABELS_DOCUMENT), "utf8");
		expect(
			await setSessionLabels(
				labels,
				parseLabelsSetParams({ sessionId: "new", labels: ["y"], note: null }),
			),
		).toEqual({ ok: false, full: true });
		expect(readFileSync(join(dir, LABELS_DOCUMENT), "utf8")).toBe(before);
		const updated = await setSessionLabels(
			labels,
			parseLabelsSetParams({ sessionId: "s1", labels: ["y"], note: null }),
		);
		expect(updated.ok).toBe(true);
	});

	test("concurrent sets of different sessions all land", async () => {
		const { store: labels } = store();
		await Promise.all(
			["a", "b", "c", "d"].map((id) =>
				setSessionLabels(labels, parseLabelsSetParams({ sessionId: id, labels: [id], note: null })),
			),
		);
		expect([...(await readLabels(labels)).sessions.keys()].sort()).toEqual(["a", "b", "c", "d"]);
	});

	test("a malformed or missing document reads as what it can, never fatal", () => {
		expect(parseLabelsDocument(undefined).sessions.size).toBe(0);
		const parsed = parseLabelsDocument({
			sessions: {
				ok: { labels: ["a", 3, "a"], note: "n" },
				bad: "x",
				empty: { labels: [] },
				long: { labels: ["y".repeat(100)] },
			},
		});
		expect([...parsed.sessions.entries()]).toEqual([["ok", { labels: ["a"], note: "n" }]]);
	});
});
