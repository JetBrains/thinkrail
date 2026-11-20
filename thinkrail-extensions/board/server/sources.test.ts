import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import type {
	ExtensionChatFacts,
	ExtensionQuery,
	ExtensionTaskSpec,
} from "@thinkrail/extension-api/server";
import { Board, type BoardView, type CardDetail } from "./board";
import { closesIssue, issueListArgv, parseIssues, withCloses } from "./github";
import type { Card } from "./model";
import { boardQueries } from "./queries";
import { PACKET_START } from "./review";
import { parseSize, wantsSize } from "./sizing";
import { parseDeferrals } from "./taskSpecs";
import { createTestHost, facts, project, ran, type TestHost } from "./testHost";

const hosts: TestHost[] = [];

const WORKSPACES = [
	{ id: "w0", name: "Default", kind: "default", branch: "main" },
	{ id: "w1", name: "bound", kind: "worktree", branch: "bound" },
	{ id: "w2", name: "loose", kind: "worktree", branch: "loose" },
	{ id: "w3", name: "finished", kind: "worktree", branch: "finished" },
] as const;

function setup(options: { ttl?: number; sizeDelayMs?: number } = {}) {
	const t = createTestHost();
	hosts.push(t);
	t.projects.splice(0, 1, project("p1", "ThinkRail", [...WORKSPACES]));
	let now = 1_000_000;
	const clock = { advance: (ms: number) => (now += ms) };
	const board = new Board(t.host, {
		now: () => ++now,
		owner: "dana",
		sizeDelayMs: options.sizeDelayMs ?? 0,
		...(options.ttl !== undefined ? { issueTtlMs: options.ttl } : {}),
	});
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	return { t, board, query, clock };
}

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

const spec = (id: string, status: string | null, title = id): ExtensionTaskSpec => ({
	id,
	title,
	status,
	path: `.thinkrail/context/${id}.md`,
});

const chat = (
	sessionId: string,
	state: ExtensionChatFacts["state"],
	updatedAt = 1,
	plan: ExtensionChatFacts["plan"] = null,
): ExtensionChatFacts => ({ sessionId, title: sessionId, state, unread: false, plan, updatedAt });

const ids = (view: BoardView) => view.cards.map((card) => card.id);

/** A board card holding workspace `w1` through an attempt (started on the fake host). */
async function boundCard(query: ReturnType<typeof setup>["query"]): Promise<Card> {
	await query("card.create", { projectId: "p1", title: "Bound", size: "S" });
	return (await query<{ card: Card }>("card.start", { cardId: "TR-1" })).card;
}

describe("the task-spec source", () => {
	test("attaches a bound workspace's task-specs to its card and shows an unbound one's open task-specs as cards", async () => {
		const { t, query } = setup();
		const card = await boundCard(query);
		expect(card.attempts[0]?.workspaceId).toBe("w1");
		t.facts.set("w1", facts("w1", { chats: [chat("s1", "working")] }));
		t.facts.set(
			"w2",
			facts("w2", { chats: [chat("s-old", "finished", 1), chat("s-new", "working", 5)] }),
		);
		t.facts.set("w3", facts("w3"));
		t.taskSpecs.set("w1", [spec("task-bound", "active", "Bound work"), spec("task-old", "done")]);
		t.taskSpecs.set("w2", [spec("task-loose", "draft", "Loose work"), spec("task-gone", "done")]);
		t.taskSpecs.set("w3", [spec("task-finished", "done")]);

		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(view)).toEqual(["TR-1", "spec:w2:task-loose"]);
		expect(view.cards[0]?.taskSpecs).toEqual([
			{
				kind: "task-spec",
				workspaceId: "w1",
				id: "task-bound",
				title: "Bound work",
				status: "active",
				path: ".thinkrail/context/task-bound.md",
			},
			expect.objectContaining({ id: "task-old", status: "done" }),
		]);
		expect(view.cards[1]).toMatchObject({
			virtual: true,
			title: "Loose work",
			source: { kind: "task-spec", ref: "task-loose", workspaceId: "w2" },
			category: "started",
			column: "building",
			attempts: [],
			taskSpecs: [expect.objectContaining({ id: "task-loose", status: "draft" })],
		});
		expect(view.cards[1]?.live[0]).toMatchObject({
			workspaceId: "w2",
			sessionId: "s-new",
			open: true,
			chat: { state: "working" },
		});
		expect(view.wip.agents.count).toBe(1);
	});

	test("place an unbound task-spec's card by its workspace's live state, with the board's rules", async () => {
		const { t, query } = setup();
		t.taskSpecs.set("w2", [spec("task-loose", "active")]);
		const column = async () =>
			(await query<BoardView>("board.get", { projectId: "p1" })).cards.find(
				(card) => card.id === "spec:w2:task-loose",
			)?.column;
		t.facts.set(
			"w2",
			facts("w2", { chats: [chat("s2", "finished")], diff: { added: 3, removed: 1 } }),
		);
		expect(await column()).toBe("review");
		t.facts.set(
			"w2",
			facts("w2", { chats: [chat("s2", "working")], diff: { added: 3, removed: 1 } }),
		);
		expect(await column()).toBe("building");
		t.facts.set("w2", facts("w2", { chats: [chat("s2", "idle", 1, { open: 0, total: 2 })] }));
		expect(await column()).toBe("review");
		t.facts.set(
			"w2",
			facts("w2", { review: { kind: "pull-request", number: 4, state: "merged" } }),
		);
		expect(await column()).toBe("done");
	});

	test("Adopt stores the card bound to its workspace with the attempt recorded, once", async () => {
		const { t, board, query } = setup();
		const stop = board.listen();
		t.facts.set("w2", facts("w2", { chats: [chat("s-a", "finished", 1), chat("s-b", "idle", 9)] }));
		t.taskSpecs.set("w2", [spec("task-loose", "active", "Loose work"), spec("task-side", "draft")]);
		const before = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(before)).toEqual(["spec:w2:task-loose", "spec:w2:task-side"]);

		const adopted = await query<Card>("card.adopt", { cardId: "spec:w2:task-loose" });
		expect(adopted).toMatchObject({
			id: "TR-1",
			title: "Loose work",
			source: { kind: "task-spec", ref: "task-loose", workspaceId: "w2" },
			specRefs: ["task-loose"],
			category: "started",
			column: "building",
			createdBy: "human",
			attempts: [{ workspaceId: "w2", sessionId: "s-b", workflow: "implement", notes: [] }],
		});
		expect(board.store.transitions("p1").at(-1)).toMatchObject({
			cardId: "TR-1",
			from: null,
			actor: "human",
			reason: "adopted from the task-spec task-loose",
		});

		const after = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(after)).toEqual(["TR-1"]);
		expect(after.cards[0]?.taskSpecs.map((ref) => ref.id)).toEqual(["task-loose", "task-side"]);
		expect((await query<Card>("card.adopt", { cardId: "spec:w2:task-side" })).id).toBe("TR-1");
		expect(board.cards("p1")).toHaveLength(1);
		expect((await query<CardDetail>("card.get", { cardId: "spec:w2:task-loose" })).card.id).toBe(
			"TR-1",
		);

		t.emit("agent.settled", { workspaceId: "w2", sessionId: "s-b" });
		t.facts.set(
			"w2",
			facts("w2", { chats: [chat("s-b", "finished", 9)], diff: { added: 1, removed: 0 } }),
		);
		t.emit("agent.settled", { workspaceId: "w2", sessionId: "s-b" });
		await board.idle();
		expect(board.find("TR-1").category).toBe("review");
		stop();
	});

	test("a task-spec's card answers card.get as is and refuses writes until adopted", async () => {
		const { t, query } = setup();
		t.facts.set("w2", facts("w2"));
		t.taskSpecs.set("w2", [spec("task-loose", "active")]);
		const detail = await query<CardDetail>("card.get", { cardId: "spec:w2:task-loose" });
		expect(detail).toMatchObject({ projectId: "p1", card: { virtual: true }, transitions: [] });
		for (const [method, extra] of [
			["card.update", { title: "x" }],
			["card.move", { column: "review" }],
			["card.start", {}],
		] as const)
			await expect(
				query(method, { cardId: "spec:w2:task-loose", projectId: "p1", ...extra }),
			).rejects.toThrow("Adopt");
		await expect(query("card.delete", { cardId: "spec:w2:task-loose" })).rejects.toThrow(
			"stays while",
		);
		await expect(query("card.adopt", { cardId: "spec:w2:task-none" })).rejects.toThrow(
			"not open in that workspace",
		);
	});

	test("a chat of an unbound workspace shown as a task-spec's card re-reads the board", async () => {
		const { t, board } = setup();
		t.facts.set("w2", facts("w2"));
		t.taskSpecs.set("w2", [spec("task-loose", "active")]);
		const stop = board.listen();
		const state = (workspaceId: string) =>
			({ sessionId: `s-${workspaceId}`, workspaceId, state: { execution: "running" } }) as never;
		t.emit("session.state", state("w2"));
		expect(t.published).toEqual([]);
		await board.get("p1");
		t.emit("session.state", state("w2"));
		t.emit("session.state", state("w3"));
		expect(t.published).toEqual([
			{ type: "board.changed", payload: { projectId: "p1" }, scope: { projectId: "p1" } },
		]);
		stop();
	});

	test("Send deferrals files the task-spec's Deferrals bullets into Triage from the card, once each", async () => {
		const { t, board, query } = setup();
		await boundCard(query);
		t.facts.set("w1", facts("w1"));
		t.taskSpecs.set("w1", [spec("task-bound", "active")]);
		t.sections.set(
			"w1:task-bound:Deferrals",
			"- Roadmap view\n  with milestones\n- [x] Already shipped\n- Charts\n- none",
		);
		const sent = await query<{ created: Card[]; skipped: number }>("card.deferrals", {
			cardId: "TR-1",
			specId: "task-bound",
		});
		expect(sent.skipped).toBe(0);
		expect(sent.created.map((card) => [card.id, card.title, card.description])).toEqual([
			["TR-2", "Roadmap view", "with milestones"],
			["TR-3", "Charts", ""],
		]);
		expect(sent.created[0]).toMatchObject({
			category: "triage",
			column: "triage",
			createdBy: "human",
			origin: { cardId: "TR-1" },
		});
		expect(sent.created[0]?.origin).not.toHaveProperty("sessionId");
		expect(board.store.transitions("p1").at(-1)).toMatchObject({
			reason: "deferred in the task-spec task-bound",
		});

		t.sections.set("w1:task-bound:Deferrals", "- Roadmap view\n- Charts\n- Linear source");
		const again = await query<{ created: Card[]; skipped: number }>("card.deferrals", {
			cardId: "TR-1",
			specId: "task-bound",
		});
		expect(again.created.map((card) => card.title)).toEqual(["Linear source"]);
		expect(again.skipped).toBe(2);
		await expect(query("card.deferrals", { cardId: "TR-1", specId: "task-other" })).rejects.toThrow(
			"not a task-spec of TR-1",
		);
		t.sections.clear();
		await expect(query("card.deferrals", { cardId: "TR-1", specId: "task-bound" })).rejects.toThrow(
			"no Deferrals section",
		);
	});

	test("Deferrals parsing takes top-level bullets only, with their indented lines", () => {
		expect(
			parseDeferrals(
				[
					"Intro prose is no deferral.",
					"",
					"- **Roadmap** (D)",
					"  - nested detail",
					"  more detail",
					"* Scrum presets",
					"1. OpenSpec source",
					"- [ ] Linear source",
					"- [x] Done already",
					"- N/A",
					"- Scrum presets",
					"",
					"### Later",
					"",
					"- Cost per card",
					"lazy continuation",
				].join("\n"),
			),
		).toEqual([
			{ title: "Roadmap (D)", description: "- nested detail\nmore detail" },
			{ title: "Scrum presets", description: "" },
			{ title: "OpenSpec source", description: "" },
			{ title: "Linear source", description: "" },
			{ title: "Cost per card", description: "lazy continuation" },
		]);
		const long = `- ${"x".repeat(400)}`;
		const [only] = parseDeferrals(long);
		expect(only?.title).toHaveLength(300);
		expect(only?.description).toBe("x".repeat(400));
		expect(parseDeferrals("No bullets here.\n\n## Other")).toEqual([]);
	});
});

const ISSUES = JSON.stringify([
	{
		number: 7,
		title: "Crash on an empty board",
		body: "Steps: open it.",
		labels: [{ name: "bug" }],
		url: "https://github.com/acme/app/issues/7",
		assignees: [{ login: "dana" }],
		updatedAt: "2026-01-02T00:00:00Z",
	},
	{
		number: 8,
		title: "Export cards",
		body: "",
		labels: [],
		url: "https://github.com/acme/app/issues/8",
		assignees: [],
		updatedAt: "2026-01-01T00:00:00Z",
	},
	{ number: "9", title: "bad" },
]);

function fakeGh(t: TestHost, issues = ISSUES) {
	const bodies: string[] = [];
	const prBody = { value: "Adds the export." };
	t.run.answer = (argv) => {
		const [, group, command] = argv;
		if (group === "issue" && command === "list") return ran(issues);
		if (group === "pr" && command === "view") return ran(JSON.stringify({ body: prBody.value }));
		if (group === "pr" && command === "edit") {
			const file = argv[argv.indexOf("--body-file") + 1] ?? "";
			bodies.push(readFileSync(file, "utf8"));
			return ran("");
		}
		return ran(`unexpected ${argv.join(" ")}`, false);
	};
	return { bodies, prBody };
}

describe("the GitHub source", () => {
	test("Show GitHub issues checks the user's gh first and explains a problem without switching on", async () => {
		const { t, query } = setup();
		t.gh.problem = "unauthenticated";
		const refused = await query<{ problem: string | null; settings: { github: unknown } }>(
			"github.set",
			{ projectId: "p1", enabled: true },
		);
		expect(refused).toMatchObject({
			problem: "unauthenticated",
			settings: { github: { enabled: false } },
		});
		expect(t.runs).toEqual([]);
		expect((await query<BoardView>("board.get", { projectId: "p1" })).github.enabled).toBe(false);
		await expect(query("github.set", { projectId: "p1" })).rejects.toThrow("enabled or filter");
		await expect(query("github.refresh", { projectId: "p1" })).rejects.toThrow("are off");
	});

	test("lists open issues with the user's gh in the Default workspace as Backlog cards, cached for the TTL", async () => {
		const { t, board, query, clock } = setup({ ttl: 60_000 });
		fakeGh(t);
		const enabled = await query<{ problem: null; settings: { github: unknown } }>("github.set", {
			projectId: "p1",
			enabled: true,
		});
		expect(enabled).toMatchObject({
			problem: null,
			settings: { github: { enabled: true, filter: "open" } },
		});
		await board.idle();
		expect(t.runs).toEqual([
			{
				workspaceId: "w0",
				argv: [
					"gh",
					"issue",
					"list",
					"--state",
					"open",
					"--limit",
					"100",
					"--json",
					"number,title,body,labels,url,assignees,updatedAt",
				],
			},
		]);
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(view)).toEqual(["#7", "#8"]);
		expect(view.cards[0]).toMatchObject({
			virtual: true,
			title: "Crash on an empty board",
			description: "Steps: open it.",
			type: "bug",
			labels: ["bug"],
			category: "backlog",
			column: "backlog",
			source: { kind: "github", number: 7, url: "https://github.com/acme/app/issues/7" },
		});
		expect(view.github).toMatchObject({ enabled: true, loading: false, error: null });
		expect(view.github.fetchedAt).toEqual(expect.any(Number));
		expect(t.published.some((push) => push.type === "board.changed")).toBe(true);

		await query("board.get", { projectId: "p1" });
		await board.idle();
		expect(t.runs).toHaveLength(1);
		clock.advance(60_000);
		await query("board.get", { projectId: "p1" });
		await board.idle();
		expect(t.runs).toHaveLength(2);
		await query("github.refresh", { projectId: "p1" });
		expect(t.runs).toHaveLength(3);

		await query("github.set", { projectId: "p1", filter: "mine" });
		await board.idle();
		expect(t.runs.at(-1)?.argv.slice(-2)).toEqual(["--assignee", "@me"]);
		expect(issueListArgv("open")).not.toContain("--assignee");
		await query("github.set", { projectId: "p1", enabled: false });
		expect(ids(await query<BoardView>("board.get", { projectId: "p1" }))).toEqual([]);
	});

	test("a failed fetch is a banner beside the last good issues, never a failed board", async () => {
		const { t, board, query } = setup();
		fakeGh(t);
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		t.run.answer = () => ({
			ok: false,
			out: "",
			err: "\nHTTP 401: Bad credentials\n",
			timedOut: false,
		});
		const status = await query<{ error: string | null }>("github.refresh", { projectId: "p1" });
		expect(status.error).toBe("HTTP 401: Bad credentials");
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(view)).toEqual(["#7", "#8"]);
		expect(view.github.error).toBe("HTTP 401: Bad credentials");
		t.run.answer = () => ({ ok: false, out: "", err: "", timedOut: true });
		expect((await query<{ error: string }>("github.refresh", { projectId: "p1" })).error).toBe(
			"gh issue list timed out.",
		);
		t.run.answer = () => ran("not json");
		expect((await query<{ error: string }>("github.refresh", { projectId: "p1" })).error).toContain(
			"something other than issues",
		);
	});

	test("editing an issue's card stores it linked to the issue, and its board state persists", async () => {
		const { t, board, query } = setup();
		fakeGh(t);
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		await expect(query("card.update", { cardId: "#7", title: "x" })).rejects.toThrow("projectId");
		const edited = await query<Card>("card.update", {
			cardId: "#7",
			projectId: "p1",
			acceptance: ["No crash"],
		});
		expect(edited).toMatchObject({
			id: "TR-1",
			title: "Crash on an empty board",
			description: "Steps: open it.",
			type: "bug",
			acceptance: ["No crash"],
			source: { kind: "github", ref: "#7", number: 7 },
		});
		expect(board.store.transitions("p1")[0]).toMatchObject({
			reason: "created from GitHub issue #7",
		});
		await query("card.move", { cardId: "#7", projectId: "p1", column: "ready" });
		const view = await query<BoardView>("board.get", { projectId: "p1" });
		expect(ids(view)).toEqual(["TR-1", "#8"]);
		expect(view.cards[0]?.column).toBe("ready");
		expect((await query<CardDetail>("card.get", { cardId: "#7", projectId: "p1" })).card.id).toBe(
			"TR-1",
		);
		expect(
			(await query<CardDetail>("card.get", { cardId: "#8", projectId: "p1" })).card,
		).toMatchObject({ virtual: true, id: "#8" });
		await expect(query("card.delete", { cardId: "#8" })).rejects.toThrow("close it on GitHub");
		await expect(
			query("card.update", { cardId: "#99", projectId: "p1", title: "x" }),
		).rejects.toThrow("not on this board");
		expect(t.runs.every((run) => run.argv[1] === "issue" && run.argv[2] === "list")).toBe(true);
	});

	test("starting an issue's card kicks off with the issue and its PR gets Closes #N, the PR body only", async () => {
		const { t, board, query } = setup();
		const gh = fakeGh(t);
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		const { card } = await query<{ card: Card }>("card.start", { cardId: "#8", projectId: "p1" });
		expect(t.created[0]?.kickoff.text).toBe(
			'Card TR-1: Export cards\n\nGitHub issue #8: https://github.com/acme/app/issues/8\nThe pull request\'s description must contain "Closes #8".',
		);
		const workspaceId = card.attempts[0]?.workspaceId ?? "";
		const service = board.listen();
		const pr = (number: number, state: "open" | "merged" = "open") =>
			({
				id: workspaceId,
				projectId: "p1",
				name: "w",
				branch: "b",
				baseBranch: "main",
				worktreePath: "/w",
				review: { kind: "pull-request", number, state },
			}) as never;
		t.emit("workspace.updated", pr(31));
		await board.idle();
		const prRuns = t.runs.filter((run) => run.argv[1] === "pr");
		expect(prRuns.map((run) => run.argv.slice(0, 5))).toEqual([
			["gh", "pr", "view", "31", "--json"],
			["gh", "pr", "edit", "31", "--body-file"],
		]);
		expect(prRuns[0]?.argv).toEqual(["gh", "pr", "view", "31", "--json", "body"]);
		expect(prRuns[1]?.argv).toHaveLength(6);
		expect(gh.bodies).toEqual(["Adds the export.\n\nCloses #8\n"]);
		expect(board.find("TR-1").attempts[0]?.closesLinked).toBe(31);

		t.emit("workspace.updated", pr(31));
		await board.idle();
		expect(t.runs.filter((run) => run.argv[1] === "pr")).toHaveLength(2);

		gh.prBody.value = "Export.\n\nFixes acme/app#8";
		t.emit("workspace.updated", pr(32));
		await board.idle();
		expect(t.runs.filter((run) => run.argv[1] === "pr").map((run) => run.argv[2])).toEqual([
			"view",
			"edit",
			"view",
		]);
		expect(board.find("TR-1").attempts[0]?.closesLinked).toBe(32);
		for (const run of t.runs) {
			expect(run.argv.slice(1, 3)).not.toEqual(["issue", "edit"]);
			expect(run.argv.slice(1, 3)).not.toEqual(["issue", "close"]);
			expect(run.argv).not.toContain("--add-label");
		}
		t.emit("workspace.updated", pr(32, "merged"));
		await board.idle();
		expect(board.find("TR-1").category).toBe("completed");
		service();
	});

	test("Add to PR and the Closes check edit the PR's body one at a time, so neither drops the other's", async () => {
		const { t, board, query } = setup();
		const gh = fakeGh(t);
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		const { card } = await query<{ card: Card }>("card.start", { cardId: "#8", projectId: "p1" });
		const workspaceId = card.attempts[0]?.workspaceId ?? "";
		const review = { kind: "pull-request", number: 31, state: "open" } as const;
		t.facts.set(workspaceId, facts(workspaceId, { review }));
		const issues = t.run.answer;
		t.run.answer = async (argv, at) => {
			if (argv[1] === "pr" && argv[2] === "view") {
				const body = gh.prBody.value;
				await Bun.sleep(10);
				return ran(JSON.stringify({ body }));
			}
			if (argv[1] === "pr" && argv[2] === "edit") {
				gh.prBody.value = readFileSync(argv[argv.indexOf("--body-file") + 1] ?? "", "utf8");
				return ran("");
			}
			return issues(argv, at);
		};
		const stop = board.listen();
		const packet = query("card.packetToPr", { cardId: card.id });
		t.emit("workspace.updated", { id: workspaceId, review } as never);
		await packet;
		await board.idle();
		expect(gh.prBody.value).toContain("Closes #8");
		expect(gh.prBody.value).toContain(PACKET_START);
		expect(board.find(card.id).attempts[0]?.closesLinked).toBe(31);
		stop();
	});

	test("a failed Closes check is retried later, not on every refresh", async () => {
		const { t, board, query, clock } = setup();
		fakeGh(t);
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		const { card } = await query<{ card: Card }>("card.start", { cardId: "#7", projectId: "p1" });
		const stop = board.listen();
		t.run.answer = () => ran("gh: Not Found", false);
		const update = {
			id: card.attempts[0]?.workspaceId,
			review: { kind: "pull-request", number: 5, state: "open" },
		} as never;
		t.emit("workspace.updated", update);
		t.emit("workspace.updated", update);
		await board.idle();
		expect(t.runs.filter((run) => run.argv[1] === "pr")).toHaveLength(1);
		expect(t.warnings.at(-1)).toContain("gh: Not Found");
		clock.advance(5 * 60_000);
		t.emit("workspace.updated", update);
		await board.idle();
		expect(t.runs.filter((run) => run.argv[1] === "pr")).toHaveLength(2);
		expect(board.find("TR-1").attempts[0]).not.toHaveProperty("closesLinked");
		stop();
	});

	test("the adapter's parsers are strict about gh's shapes", () => {
		expect(parseIssues(ISSUES)?.map((issue) => issue.number)).toEqual([7, 8]);
		expect(parseIssues("{}")).toBeNull();
		expect(parseIssues("nope")).toBeNull();
		expect(closesIssue("Closes #8", 8)).toBe(true);
		expect(closesIssue("fixes: #8.", 8)).toBe(true);
		expect(closesIssue("Resolved acme/app#8", 8)).toBe(true);
		expect(closesIssue("Closes #80", 8)).toBe(false);
		expect(closesIssue("Refs #8", 8)).toBe(false);
		expect(closesIssue("encloses #8", 8)).toBe(false);
		expect(withCloses("", 3)).toBe("Closes #3\n");
		expect(withCloses("Body\n\n", 3)).toBe("Body\n\nCloses #3\n");
	});
});

describe("size suggestions", () => {
	test("parse only a bare S, M or L", () => {
		for (const [answer, size] of [
			["M", "M"],
			[" m. ", "M"],
			["**L**", "L"],
			["`S`", "S"],
		] as const)
			expect(parseSize(answer)).toBe(size);
		for (const answer of ["Medium", "M or L", "S/M", "", "XL", "Size: M", "I think M"])
			expect(parseSize(answer)).toBeNull();
	});

	test("a human's card created without a size gets the assist model's suggestion", async () => {
		const { t, board, query } = setup();
		t.assist.answer = () => ({ text: "M" });
		await query("card.create", {
			projectId: "p1",
			title: "Roadmap view",
			description: "Now, next, later.",
		});
		await query("card.create", { projectId: "p1", title: "Sized", size: "S" });
		await board.idle();
		expect(t.asks).toHaveLength(1);
		expect(t.asks[0]).toContain("Title: Roadmap view");
		expect(t.asks[0]).toContain("Description: Now, next, later.");
		expect(t.asks[0]).toContain("exactly one letter");
		expect(board.find("TR-1")).toMatchObject({ size: "M", sizeSuggested: true });
		expect(board.find("TR-2")).toMatchObject({ size: "S" });
		expect(board.find("TR-2")).not.toHaveProperty("sizeSuggested");
	});

	test("never overwrite a size the human set while the suggestion was on its way", async () => {
		const { t, board, query } = setup();
		let answer: (value: { text: string }) => void = () => {};
		t.host.actions.assist = () => new Promise((resolve) => (answer = resolve));
		await query("card.create", { projectId: "p1", title: "Roadmap view" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		await query("card.update", { cardId: "TR-1", size: "L" });
		answer({ text: "S" });
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ size: "L" });
		expect(board.find("TR-1")).not.toHaveProperty("sizeSuggested");
		await query("card.update", { cardId: "TR-1", title: "Roadmap" });
		await board.idle();
		expect(wantsSize(board.find("TR-1"))).toBe(false);
	});

	test("skip silently without a model, with the extension off, and for an agent's card", async () => {
		const { t, board, query } = setup();
		await query("card.create", { projectId: "p1", title: "No model" });
		await board.idle();
		expect(board.find("TR-1")).not.toHaveProperty("size");
		t.host.actions.assist = async () => {
			throw Object.assign(new Error("off"), { code: "EXTENSION_DISABLED" });
		};
		await query("card.create", { projectId: "p1", title: "Switched off" });
		await board.idle();
		expect(t.warnings).toEqual([]);
		expect(board.find("TR-2")).not.toHaveProperty("size");
		const asked: string[] = [];
		t.host.actions.assist = async ({ prompt }) => {
			asked.push(prompt);
			return { text: "S" };
		};
		board.createCard("p1", { title: "Agent's", size: "L", origin: { sessionId: "s" } }, "agent");
		board.createCard("p1", { title: "Agent's unsized", origin: { sessionId: "s" } }, "agent");
		await board.idle();
		expect(asked).toEqual([]);
		expect(board.find("TR-3")).toMatchObject({ size: "L", sizeSuggested: true });
		expect(board.find("TR-4")).not.toHaveProperty("size");
	});

	test("debounce edits, run one suggestion per card at a time, and re-suggest only the board's own size", async () => {
		const { t, board, query } = setup({ sizeDelayMs: 20 });
		const answers = ["S", "M", "L"];
		t.assist.answer = () => ({ text: answers.shift() ?? "L" });
		await query("card.create", { projectId: "p1", title: "One" });
		await query("card.update", { cardId: "TR-1", description: "More" });
		await query("card.update", { cardId: "TR-1", acceptance: ["Done"] });
		await board.idle();
		expect(t.asks).toHaveLength(1);
		expect(t.asks[0]).toContain("Acceptance criteria:\n- Done");
		expect(board.find("TR-1")).toMatchObject({ size: "S", sizeSuggested: true });
		await query("card.update", { cardId: "TR-1", labels: ["ui"] });
		await board.idle();
		expect(t.asks).toHaveLength(1);
		await query("card.update", { cardId: "TR-1", title: "One, bigger" });
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ size: "M", sizeSuggested: true });
		await query("card.update", { cardId: "TR-1", size: "M" });
		await query("card.update", { cardId: "TR-1", title: "One, final" });
		await board.idle();
		expect(t.asks).toHaveLength(2);
		expect(board.find("TR-1")).not.toHaveProperty("sizeSuggested");
	});

	test("an issue's card stored without a size gets a suggestion too", async () => {
		const { t, board, query } = setup();
		fakeGh(t);
		t.assist.answer = () => ({ text: "L" });
		await query("github.set", { projectId: "p1", enabled: true });
		await board.idle();
		await query("card.move", { cardId: "#8", projectId: "p1", column: "ready" });
		await board.idle();
		expect(board.find("TR-1")).toMatchObject({ size: "L", sizeSuggested: true });
	});
});
