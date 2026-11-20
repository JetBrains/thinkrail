import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionQuery } from "@thinkrail/extension-api/server";
import { Board } from "./board";
import type { DiscoveryView, IdeaView } from "./discovery";
import type { Idea, Initiative, WatchEntry } from "./model";
import { boardQueries } from "./queries";
import { createTestHost, project, type TestHost } from "./testHost";
import { createBoardTools } from "./tools";

const hosts: TestHost[] = [];
const NOW = Date.parse("2026-11-18T12:00:00Z");

interface Registered {
	name: string;
	execute: (
		id: string,
		params: unknown,
		signal: undefined,
		update: undefined,
		ctx: unknown,
	) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

function setup() {
	const t = createTestHost();
	hosts.push(t);
	t.projects[0] = project("p1", "ThinkRail", [
		{ id: "w-default", name: "Default", kind: "default", branch: "main" },
	]);
	t.places.set("/worktrees/default", { projectId: "p1", workspaceId: "w-default" });
	const clock = { now: NOW };
	const board = new Board(t.host, { now: () => clock.now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	const registered = new Map<string, Registered>();
	createBoardTools(() => board)({
		registerTool: (tool: Registered) => registered.set(tool.name, tool),
		on: () => {},
	} as unknown as ExtensionAPI);
	const call = (name: string, params: unknown, cwd = "/worktrees/default") =>
		(registered.get(name) as Registered).execute("call", params, undefined, undefined, {
			cwd,
			sessionManager: { getSessionId: () => "s1" },
		});
	const discovery = () => query<DiscoveryView>("discovery.get", { projectId: "p1" });
	return { t, board, query, call, clock, discovery };
}

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

describe("discovery queries", () => {
	test("validate their params before touching the board", async () => {
		const { query } = setup();
		await query("idea.create", { projectId: "p1", title: "Offline" });
		await query("watchlist.create", { projectId: "p1", name: "Linear" });
		const refusals: [string, unknown, string][] = [
			["discovery.get", { projectId: "nope" }, "No open project"],
			["idea.create", { projectId: "p1" }, "non-empty title"],
			["idea.update", { projectId: "p1", ideaId: "D-9" }, "No idea D-9"],
			["idea.update", { projectId: "p1", ideaId: "D-1", value: { score: 6 } }, "from 1 to 5"],
			["idea.update", { projectId: "p1", ideaId: "D-1", value: { score: 2.5 } }, "whole number"],
			["idea.update", { projectId: "p1", ideaId: "D-1", value: 3 }, "must be an object"],
			["idea.update", { projectId: "p1", ideaId: "D-1", effort: {} }, "effort.score"],
			["idea.update", { projectId: "p1", ideaId: "D-1", dismissed: "yes" }, "true or false"],
			["idea.addEvidence", { projectId: "p1", ideaId: "D-1", kind: "rumour", ref: "x" }, "kind"],
			[
				"idea.addEvidence",
				{ projectId: "p1", ideaId: "D-1", kind: "url", ref: "ftp://x" },
				"http(s)",
			],
			[
				"idea.addEvidence",
				{ projectId: "p1", ideaId: "D-1", kind: "artifact", ref: "../secret.md" },
				"relative to the workspace",
			],
			[
				"idea.addEvidence",
				{ projectId: "p1", ideaId: "D-1", kind: "artifact", ref: "/etc/passwd" },
				"relative to the workspace",
			],
			["idea.removeEvidence", { projectId: "p1", ideaId: "D-1", evidenceId: "E-9" }, "no evidence"],
			["watchlist.create", { projectId: "p1", name: "x", urls: ["linear.app"] }, "http(s)"],
			["watchlist.update", { projectId: "p1", watchId: "W-9" }, "No watchlist entry W-9"],
			["discovery.chat", { projectId: "p1", kind: "dream" }, "kind must be one of"],
			["discovery.chat", { projectId: "p1", kind: "research" }, "Pass the ideaId to research"],
			["discovery.chat", { projectId: "p1", kind: "analyze", ideaId: "D-9" }, "No idea D-9"],
			["discovery.chat", { projectId: "p1", kind: "watch", watchId: "W-9" }, "No watchlist entry"],
		];
		for (const [method, params, message] of refusals)
			await expect(query(method, params)).rejects.toThrow(message);
	});

	test("create, edit, score by hand, dismiss and delete ideas with their evidence, publishing board.changed", async () => {
		const { t, query, discovery } = setup();
		const created = await query<Idea>("idea.create", {
			projectId: "p1",
			title: " Offline mode ",
			pitch: "Work on a plane",
		});
		expect(created).toMatchObject({
			id: "D-1",
			title: "Offline mode",
			status: "new",
			evidence: [],
		});
		expect(t.published.at(-1)).toMatchObject({
			type: "board.changed",
			payload: { projectId: "p1" },
		});
		await query("idea.create", { projectId: "p1", title: "Second" });

		const added = await query<{ idea: Idea }>("idea.addEvidence", {
			projectId: "p1",
			ideaId: "d-1",
			kind: "url",
			ref: "https://example.com/forum",
			quote: "Please add offline",
		});
		expect(added.idea.evidence).toEqual([
			{
				id: "E-1",
				kind: "url",
				ref: "https://example.com/forum",
				quote: "Please add offline",
				addedBy: "human",
				at: NOW,
			},
		]);
		await query("idea.addEvidence", {
			projectId: "p1",
			ideaId: "D-1",
			kind: "artifact",
			ref: "./.thinkrail/context/notes.md",
			workspaceId: "w-default",
		});
		await query("idea.addEvidence", {
			projectId: "p1",
			ideaId: "D-1",
			kind: "note",
			ref: "Asked twice",
		});
		const removed = await query<Idea>("idea.removeEvidence", {
			projectId: "p1",
			ideaId: "D-1",
			evidenceId: "E-3",
		});
		expect(
			removed.evidence.map((evidence) => [evidence.id, evidence.ref, evidence.workspaceId]),
		).toEqual([
			["E-1", "https://example.com/forum", undefined],
			["E-2", ".thinkrail/context/notes.md", "w-default"],
		]);

		const scored = await query<Idea>("idea.update", {
			projectId: "p1",
			ideaId: "D-1",
			value: { score: 4, reasons: ["Users ask (E-1)"] },
			effort: { score: 2 },
		});
		expect(scored).toMatchObject({
			status: "analyzed",
			value: { score: 4, reasons: ["Users ask (E-1)"], suggested: false },
			effort: { score: 2, reasons: [], suggested: false },
		});
		const dismissed = await query<Idea>("idea.update", {
			projectId: "p1",
			ideaId: "D-1",
			dismissed: true,
		});
		expect(dismissed.status).toBe("dismissed");
		const back = await query<Idea>("idea.update", {
			projectId: "p1",
			ideaId: "D-1",
			dismissed: false,
		});
		expect(back.status).toBe("analyzed");
		const cleared = await query<Idea>("idea.update", {
			projectId: "p1",
			ideaId: "D-1",
			value: null,
			effort: null,
			title: "Offline first",
		});
		expect(cleared).toMatchObject({ status: "new", title: "Offline first" });
		expect(cleared).not.toHaveProperty("value");

		expect(await query("idea.delete", { projectId: "p1", ideaId: "D-2" })).toEqual({
			deleted: "D-2",
		});
		expect((await discovery()).ideas.map((idea) => idea.id)).toEqual(["D-1"]);
		expect((await query<Idea>("idea.create", { projectId: "p1", title: "Third" })).id).toBe("D-3");
	});

	test("the watchlist: add, edit and delete competitors with W-n ids", async () => {
		const { query, discovery } = setup();
		const entry = await query<WatchEntry>("watchlist.create", {
			projectId: "p1",
			name: "Linear",
			urls: ["https://linear.app", " "],
			notes: "Issue tracker",
		});
		expect(entry).toMatchObject({
			id: "W-1",
			urls: ["https://linear.app/"],
			notes: "Issue tracker",
		});
		const edited = await query<WatchEntry>("watchlist.update", {
			projectId: "p1",
			watchId: "w-1",
			urls: ["https://linear.app/changelog"],
		});
		expect(edited).toMatchObject({ name: "Linear", urls: ["https://linear.app/changelog"] });
		await query("watchlist.create", { projectId: "p1", name: "Jira" });
		await query("watchlist.delete", { projectId: "p1", watchId: "W-1" });
		expect((await discovery()).watchlist.map((candidate) => candidate.id)).toEqual(["W-2"]);
	});
});

describe("discovery chats and the agent's tools", () => {
	test("research, analyze and watch kickoffs name their skill and stand alone, in the Default workspace", async () => {
		const { t, query } = setup();
		await query("idea.create", {
			projectId: "p1",
			title: "Offline mode",
			pitch: "Work on a plane",
		});
		await query("idea.addEvidence", {
			projectId: "p1",
			ideaId: "D-1",
			kind: "url",
			ref: "https://example.com/forum",
			quote: "Please add offline",
		});
		const research = await query<Record<string, unknown>>("discovery.chat", {
			projectId: "p1",
			kind: "research",
			ideaId: "D-1",
		});
		expect(research).toMatchObject({ projectId: "p1", workspaceId: "w-default" });
		const text = t.chats.at(-1)?.kickoff.text ?? "";
		expect(research.kickoff).toBe(text);
		expect(t.chats.at(-1)?.workspaceId).toBe("w-default");
		expect(
			text.startsWith("/skill:discovery-research Research idea D-1 of the ThinkRail board."),
		).toBe(true);
		expect(text).toContain(
			'Idea D-1: Offline mode\nPitch: Work on a plane\nEvidence:\n- E-1 (url) https://example.com/forum: "Please add offline"\nValue: not scored yet.',
		);
		expect(text).toContain(".thinkrail/context/research-D-1-2026-11-18.md");
		expect(text).toContain("web_search");
		expect(text).toContain('board_idea_add_evidence { ideaId: "D-1", kind: "artifact"');

		await query("discovery.chat", { projectId: "p1", kind: "analyze", ideaId: "D-1" });
		const analyze = t.chats.at(-1)?.kickoff.text ?? "";
		expect(analyze.startsWith("/skill:discovery-analyze Analyze idea D-1")).toBe(true);
		for (const part of [
			"spec_search",
			"session insights if a tool",
			"MCP tools",
			"board_idea_score",
		])
			expect(analyze).toContain(part);

		await expect(query("discovery.chat", { projectId: "p1", kind: "watch" })).rejects.toThrow(
			"watchlist is empty",
		);
		await query("watchlist.create", {
			projectId: "p1",
			name: "Linear",
			urls: ["https://linear.app"],
		});
		await query("watchlist.create", { projectId: "p1", name: "Jira", notes: "The incumbent" });
		await query("discovery.chat", { projectId: "p1", kind: "watch" });
		const all = t.chats.at(-1)?.kickoff.text ?? "";
		expect(all.startsWith("/skill:competitor-watch Check what changed at the competitors")).toBe(
			true,
		);
		expect(all).toContain(
			"- W-1 Linear: https://linear.app/ (no snapshot yet)\n- W-2 Jira: no URLs yet — The incumbent (no snapshot yet)",
		);
		expect(all).toContain("board_watchlist_snapshot");
		expect(all).toContain(".thinkrail/context/competitor-watch-2026-11-18.md");
		await query("discovery.chat", { projectId: "p1", kind: "watch", watchId: "w-2" });
		const one = t.chats.at(-1)?.kickoff.text ?? "";
		expect(one).toContain("Check what changed at Jira (W-2)");
		expect(one).not.toContain("W-1 Linear");
		expect(one).toContain('board_watchlist_get { watchId: "W-2" }');

		t.chat.kickoffError = "No model selected";
		expect(
			await query("discovery.chat", { projectId: "p1", kind: "analyze", ideaId: "D-1" }),
		).toMatchObject({ kickoffError: "No model selected" });
	});

	test("an agent files ideas, attaches evidence from its workspace and reads them", async () => {
		const { call, discovery } = setup();
		const created = await call("board_idea_create", { title: " Offline ", pitch: "Planes" });
		expect(created.details.idea).toMatchObject({ id: "D-1", title: "Offline", status: "new" });
		const attached = await call("board_idea_add_evidence", {
			ideaId: "D-1",
			kind: "artifact",
			ref: "/worktrees/default/.thinkrail/context/research-D-1.md",
			quote: "Two competitors do it",
		});
		expect(attached.details.evidence).toMatchObject({
			id: "E-1",
			kind: "artifact",
			ref: ".thinkrail/context/research-D-1.md",
			workspaceId: "w-default",
			addedBy: "agent",
		});
		await expect(
			call("board_idea_add_evidence", {
				ideaId: "D-1",
				kind: "artifact",
				ref: "/tmp/elsewhere.md",
			}),
		).rejects.toThrow("outside this workspace");
		await call("board_idea_add_evidence", {
			ideaId: "D-1",
			kind: "url",
			ref: "https://a.example/",
		});
		expect((await discovery()).ideas[0]?.evidence.map((evidence) => evidence.addedBy)).toEqual([
			"agent",
			"agent",
		]);
		const listed = await call("board_ideas_list", {});
		expect(listed.content[0]?.text).toBe("D-1 [new] Offline (not scored, 2 evidence)");
		const read = await call("board_ideas_list", { ideaId: "d-1" });
		expect(read.content[0]?.text).toContain(
			'- E-1 (artifact) .thinkrail/context/research-D-1.md: "Two competitors do it"',
		);
		expect((await call("board_ideas_list", { status: "promoted" })).content[0]?.text).toContain(
			"No ideas promoted",
		);
	});

	test("board_idea_score suggests scores with reasons and never overwrites one the human set", async () => {
		const { call, query } = setup();
		await query("idea.create", { projectId: "p1", title: "Offline" });
		const first = await call("board_idea_score", {
			ideaId: "D-1",
			value: { score: 4, reasons: ["Moves capability X (E-1)"] },
			effort: { score: 3, reasons: ["New sync layer"] },
			horizon: { horizon: "next", reason: "After the sync rewrite" },
		});
		expect(first.details.idea).toMatchObject({
			status: "analyzed",
			value: { score: 4, reasons: ["Moves capability X (E-1)"], suggested: true },
			effort: { score: 3, suggested: true },
			horizonSuggestion: { horizon: "next", reason: "After the sync rewrite" },
		});
		await query("idea.update", { projectId: "p1", ideaId: "D-1", value: { score: 4 } });
		const second = await call("board_idea_score", {
			ideaId: "D-1",
			value: { score: 1, reasons: ["Changed my mind"] },
			effort: { score: 2, reasons: ["Smaller than thought"] },
		});
		const idea = second.details.idea as Idea;
		expect(idea.value).toEqual({
			score: 4,
			reasons: ["Moves capability X (E-1)"],
			suggested: false,
		});
		expect(idea.effort).toEqual({ score: 2, reasons: ["Smaller than thought"], suggested: true });
		expect(second.details.kept).toEqual(["value"]);
		expect(second.content[0]?.text).toContain("The human set value 4; it stays.");
		await expect(
			call("board_idea_score", { ideaId: "D-1", effort: { score: 2, reasons: [" "] } }),
		).rejects.toThrow("reasons for the effort");
		await expect(call("board_idea_score", { ideaId: "D-1" })).rejects.toThrow("Pass a value");
	});

	test("board_watchlist_snapshot stores the new snapshot and returns the previous one", async () => {
		const { call, query, clock, discovery } = setup();
		await query("watchlist.create", {
			projectId: "p1",
			name: "Linear",
			urls: ["https://linear.app"],
		});
		const first = await call("board_watchlist_snapshot", {
			watchId: "W-1",
			text: "Features: issues\nPricing: $8",
			artifactPath: ".thinkrail/context/competitor-watch-2026-11-18.md",
		});
		expect(first.details.previous).toBeNull();
		expect(first.content[0]?.text).toContain("no previous one");
		clock.now = NOW + 86_400_000;
		const second = await call("board_watchlist_snapshot", {
			watchId: "w-1",
			text: "Features: issues, cycles\nPricing: $10",
		});
		expect(second.details.previous).toMatchObject({
			at: NOW,
			text: "Features: issues\nPricing: $8",
		});
		expect(second.content[0]?.text).toContain(
			"The previous one, of 2026-11-18, to diff against:\n\nFeatures: issues\nPricing: $8",
		);
		const [entry] = (await discovery()).watchlist;
		expect(entry?.snapshot).toEqual({
			at: NOW + 86_400_000,
			text: "Features: issues, cycles\nPricing: $10",
		});
		expect(entry?.previous).toEqual({
			at: NOW,
			text: "Features: issues\nPricing: $8",
			artifactPath: ".thinkrail/context/competitor-watch-2026-11-18.md",
			workspaceId: "w-default",
		});
		const read = await call("board_watchlist_get", {});
		expect(read.content[0]?.text).toContain(
			"W-1 · Linear\nURLs: https://linear.app/\nLast snapshot (2026-11-19):\nFeatures: issues, cycles",
		);
		await expect(call("board_watchlist_snapshot", { watchId: "W-1", text: " " })).rejects.toThrow(
			"snapshot's text",
		);
	});

	test("Promote opens a Shape chat carrying the idea, and the drafted initiative links back to it", async () => {
		const { t, query, call, discovery } = setup();
		await query("idea.create", {
			projectId: "p1",
			title: "Offline mode",
			pitch: "Work on a plane",
		});
		await query("idea.addEvidence", {
			projectId: "p1",
			ideaId: "D-1",
			kind: "url",
			ref: "https://example.com/forum",
			quote: "Please add offline",
		});
		await call("board_idea_score", {
			ideaId: "D-1",
			value: { score: 5, reasons: ["Top request (E-1)"] },
			horizon: { horizon: "now", reason: "Asked weekly" },
		});
		const started = await query<Record<string, unknown>>("idea.promote", {
			projectId: "p1",
			ideaId: "D-1",
		});
		expect(started).toMatchObject({ projectId: "p1", workspaceId: "w-default" });
		const text = t.chats.at(-1)?.kickoff.text ?? "";
		expect(text.startsWith("/skill:roadmap-shape Shape idea D-1 of the ThinkRail board")).toBe(
			true,
		);
		expect(text).toContain("Pitch: Work on a plane");
		expect(text).toContain('- E-1 (url) https://example.com/forum: "Please add offline"');
		expect(text).toContain("Value: 5 of 5 (suggested) — Top request (E-1)");
		expect(text).toContain("Suggested horizon: now — Asked weekly");
		expect(text).toContain(
			'board_initiative_create_draft { title, outcome, criteria, horizon, ideaId: "D-1" }',
		);

		const drafted = await call("board_initiative_create_draft", {
			title: "Offline mode",
			outcome: "Work anywhere",
			ideaId: "d-1",
		});
		const initiative = drafted.details.initiative as Initiative;
		expect(initiative).toMatchObject({ id: "I-1", proposed: true });
		expect(drafted.content[0]?.text).toContain("Idea D-1 is promoted to it.");
		const [idea] = (await discovery()).ideas as IdeaView[];
		expect(idea).toMatchObject({
			status: "promoted",
			initiativeId: "I-1",
			initiative: { id: "I-1", title: "Offline mode" },
		});
		await expect(query("idea.promote", { projectId: "p1", ideaId: "D-1" })).rejects.toThrow(
			"already promoted to I-1",
		);
		await expect(
			call("board_initiative_create_draft", { title: "Again", outcome: "x", ideaId: "D-1" }),
		).rejects.toThrow("already promoted");
		expect(
			(await query<{ initiatives: Initiative[] }>("roadmap.get", { projectId: "p1" })).initiatives,
		).toHaveLength(1);
		await expect(
			query("idea.update", { projectId: "p1", ideaId: "D-1", dismissed: true }),
		).rejects.toThrow("can't be dismissed");

		await query("idea.create", { projectId: "p1", title: "Dropped" });
		await query("idea.update", { projectId: "p1", ideaId: "D-2", dismissed: true });
		await expect(query("idea.promote", { projectId: "p1", ideaId: "D-2" })).rejects.toThrow(
			"is dismissed",
		);
	});
});
