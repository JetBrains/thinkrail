import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHistoryIndex, HistoryIndex, makeSnippet, matchesTerms } from "./historyIndex";
import { writeFixtureSession } from "./testFixtures";

const allowAll = () => true;
const noLabels = () => ({});

describe("HistoryIndex.search", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "trpi-history-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("(a) AND-matches terms and orders hits by recency across sessions", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "deploy the frontend service", timestamp: 1000 },
				{ role: "assistant", text: "the frontend service deployed cleanly", timestamp: 3000 },
			],
		});
		writeFixtureSession(dir, {
			id: "sess-b",
			cwd: "/repo/b",
			messages: [
				{ role: "user", text: "deploy the backend service", timestamp: 2000 },
				{ role: "user", text: "unrelated note about lunch", timestamp: 4000 },
			],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({
			query: "deploy service",
			filter: allowAll,
			labels: noLabels,
		});

		// AND matching: "unrelated note about lunch" (no "deploy") never appears.
		// messages is assistant-only, so only sess-a's assistant line qualifies; the two
		// user-role "deploy ... service" hits surface as prompts instead.
		expect(result.messages.map((m) => m.timestamp)).toEqual([3000]);
		expect(result.messages.map((m) => m.sessionId)).toEqual(["sess-a"]);
		// Cross-session recency still holds for prompts: sess-b's t=2000 sorts ahead of sess-a's
		// t=1000, even though sess-a's file was written first — proves the merge is global, not
		// grouped per session.
		expect(result.prompts.map((p) => p.timestamp)).toEqual([2000, 1000]);
		expect(result.prompts.map((p) => p.sessionId)).toEqual(["sess-b", "sess-a"]);
		// Tiny fixture — the cold build finishes well inside the 150ms budget.
		expect(result.indexing).toBe(false);
	});

	test("(b) dedups prompts by normalized text, keeping the newest", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: "fix   the bug", timestamp: 1000 }],
		});
		writeFixtureSession(dir, {
			id: "sess-b",
			cwd: "/repo/b",
			messages: [{ role: "user", text: "fix the bug", timestamp: 5000 }],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({ query: "fix bug", filter: allowAll, labels: noLabels });

		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.timestamp).toBe(5000);
		expect(result.prompts[0]?.sessionId).toBe("sess-b");
		expect(result.promptTotal).toBe(1);
	});

	test("(c) scope filter by cwd excludes the other session's hits", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: "alpha message about widgets", timestamp: 1000 }],
		});
		writeFixtureSession(dir, {
			id: "sess-b",
			cwd: "/repo/b",
			messages: [{ role: "user", text: "beta message about widgets", timestamp: 2000 }],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({
			query: "widgets",
			filter: (cwd) => cwd === "/repo/a",
			labels: noLabels,
		});

		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.sessionId).toBe("sess-a");
		expect(result.promptTotal).toBe(1);
	});

	test("(d) empty query returns recent prompts but zero messages", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "hello there", timestamp: 1000 },
				{ role: "assistant", text: "hi, how can I help", timestamp: 2000 },
			],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({ query: "", filter: allowAll, labels: noLabels });

		expect(result.messages).toEqual([]);
		expect(result.messageTotal).toBe(0);
		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.text).toBe("hello there");
		expect(result.promptTotal).toBe(1);
	});

	test("(e) totals are pre-cap counts, filtered per section — they exceed the returned page when limit is smaller", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [
				{ role: "user", text: "widget one", timestamp: 1000 },
				{ role: "user", text: "widget two", timestamp: 2000 },
				{ role: "user", text: "widget three", timestamp: 3000 },
				{ role: "assistant", text: "widget four report", timestamp: 4000 },
				{ role: "assistant", text: "widget five report", timestamp: 5000 },
				{ role: "assistant", text: "widget six report", timestamp: 6000 },
			],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({
			query: "widget",
			limit: 2,
			filter: allowAll,
			labels: noLabels,
		});

		// prompts (user-role) and messages (assistant-role) are counted/capped independently —
		// 3 of each match "widget", so each section's total is 3 (not 6), and each cap keeps its own
		// newest 2, proving the role filter and the pagination cap compose correctly.
		expect(result.prompts).toHaveLength(2);
		expect(result.promptTotal).toBe(3);
		expect(result.prompts.map((p) => p.timestamp)).toEqual([3000, 2000]);
		expect(result.messages).toHaveLength(2);
		expect(result.messageTotal).toBe(3);
		expect(result.messages.map((m) => m.timestamp)).toEqual([6000, 5000]);
	});

	test("(f) revalidates after the 2s throttle and picks up an appended line", async () => {
		const path = writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: "original prompt one", timestamp: 1000 }],
		}).path;

		const index = new HistoryIndex(dir);
		const first = await index.search({ query: "prompt", filter: allowAll, labels: noLabels });
		expect(first.prompts.map((p) => p.text)).toEqual(["original prompt one"]);

		// Append a new message entry onto the same file — mtime naturally bumps on write.
		appendFileSync(
			path,
			`${JSON.stringify({
				type: "message",
				id: "sess-a-m1",
				parentId: "sess-a-m0",
				timestamp: new Date(9000).toISOString(),
				message: { role: "user", content: "fresh prompt two", timestamp: 9000 },
			})}\n`,
		);

		// Pass the 2000ms revalidation throttle so the next search re-lists and re-parses.
		await Bun.sleep(2100);

		const second = await index.search({ query: "prompt", filter: allowAll, labels: noLabels });
		expect(second.prompts.map((p) => p.text)).toEqual(["fresh prompt two", "original prompt one"]);
	});

	test("(g) a user-text match produces a jumpable prompt hit (messageIndex + 120-char anchorText) and no message hit", async () => {
		const longText = `${"x".repeat(150)} needle ${"y".repeat(150)}`;
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [{ role: "user", text: longText, timestamp: 1000 }],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({ query: "needle", filter: allowAll, labels: noLabels });

		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.messageIndex).toBe(0);
		expect(result.prompts[0]?.anchorText).toBe(longText.slice(0, 120));
		// messages is assistant-only — a user-role hit never gets a separate message hit; the
		// location it used to carry now lives on the prompt hit above instead.
		expect(result.messages).toHaveLength(0);
		expect(result.messageTotal).toBe(0);
	});

	// R1 step 0 (task-R1R2-brief.md): the web zoomed-stage preview pane renders a message hit's FULL
	// text, not its truncated `snippet`. `search()`'s message-hit construction spreads the same `hit`
	// object it builds for prompts (`{ ...hit, role, snippet, messageIndex, anchorText }`) — `text` is
	// never overwritten in that spread, so it already carries `entry.text` (the extractor's full,
	// 4000-char-capped text) unchanged. This pins that invariant with an **assistant**-role message,
	// deliberately: an assistant entry can never become a `promptCandidate` (only `role === "user"`
	// does), so a passing assertion here can only be explained by the message-hit-specific construction
	// path itself carrying the full text — not by some accidental aliasing with the prompts branch.
	test("(h) an assistant-text match produces a message hit — full text, snippet, anchorText", async () => {
		const longText = `intro ${"padding ".repeat(40)}needle-marker ${"more-padding ".repeat(40)}`;
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			messages: [{ role: "assistant", text: longText, timestamp: 1000 }],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({
			query: "needle-marker",
			filter: allowAll,
			labels: noLabels,
		});

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("assistant");
		expect(result.messages[0]?.text).toBe(longText);
		expect(result.messages[0]?.anchorText).toBe(longText.slice(0, 120));
		expect(result.messages[0]?.snippet).toContain("needle-marker");
		expect(result.messages[0]?.snippet.length).toBeLessThan(longText.length);
		expect(result.messages[0]?.text.length).toBeGreaterThan(
			result.messages[0]?.snippet.length ?? 0,
		);
		// Confirms the fixture's assistant-only setup: no prompt hit exists to have accidentally supplied
		// `.text` instead.
		expect(result.prompts).toHaveLength(0);
	});

	test("scope labels (workspaceId/projectId) are merged onto every hit", async () => {
		writeFixtureSession(dir, {
			id: "sess-a",
			cwd: "/repo/a",
			name: "My chat",
			messages: [{ role: "user", text: "labelled prompt", timestamp: 1000 }],
		});

		const index = new HistoryIndex(dir);
		const result = await index.search({
			query: "labelled",
			filter: allowAll,
			labels: () => ({ workspaceId: "ws1", projectId: "proj1" }),
		});

		expect(result.prompts[0]).toMatchObject({
			workspaceId: "ws1",
			projectId: "proj1",
			cwd: "/repo/a",
			sessionTitle: "My chat",
		});
	});
});

describe("getHistoryIndex", () => {
	test("is a lazy singleton", () => {
		expect(getHistoryIndex()).toBe(getHistoryIndex());
	});
});

describe("matchesTerms", () => {
	test("requires every term to be a case-insensitive substring", () => {
		expect(matchesTerms("Fix the Bug", ["fix", "bug"])).toBe(true);
		expect(matchesTerms("fix the bug", ["fix", "typo"])).toBe(false);
	});

	test("an empty term is vacuously true (empty-query semantics)", () => {
		expect(matchesTerms("anything at all", [""])).toBe(true);
	});
});

describe("makeSnippet", () => {
	test("windows around the first case-insensitive match", () => {
		expect(makeSnippet("aaa NEEDLE bbb", "needle")).toBe("aaa NEEDLE bbb");
	});

	test("truncates with ellipses when the match is far from either edge", () => {
		const text = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
		const snippet = makeSnippet(text, "needle", 10);
		expect(snippet).toContain("needle");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		expect(snippet.length).toBeLessThan(text.length);
	});
});
