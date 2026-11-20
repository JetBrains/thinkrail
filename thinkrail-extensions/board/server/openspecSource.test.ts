import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { ExtensionQuery, ExtensionRunResult } from "@thinkrail/extension-api/server";
import { Board, type BoardView, type CardDetail, type CardView } from "./board";
import type { Card } from "./model";
import { OPENSPEC_ARGV, PROBE_RETRY_MS, parseYaml } from "./openspec";
import { fixtureTree, recorded } from "./openspec/fixtureTree";
import { boardQueries } from "./queries";
import { createTestHost, facts, project, ran, type TestHost } from "./testHost";

const hosts: TestHost[] = [];

afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

const WORKSPACES = [
	{ id: "w0", name: "Default", kind: "default", branch: "main" },
	{ id: "w1", name: "apply", kind: "worktree", branch: "apply" },
] as const;

/** A fake `openspec`: absent unless `cli` is set, else answering with a fixture's recorded JSON. */
function setup(fixture: string, options: { cli?: string } = {}) {
	const t = createTestHost();
	hosts.push(t);
	t.projects.splice(0, 1, project("p1", "Payments API", [...WORKSPACES]));
	t.facts.set("w0", facts("w0", { kind: "default" }));
	t.openspec.set("w0", fixtureTree(fixture));
	const cli = { fixture, version: options.cli };
	t.run.answer = (argv): ExtensionRunResult => {
		if (argv[0] !== "openspec" || !cli.version) return ran("openspec: command not found", false);
		const command = argv.slice(1).join(" ");
		if (command === "--version") return ran(`${cli.version}\n`);
		if (command.startsWith("list")) return ran(recorded(cli.fixture, "list.json"));
		if (command.startsWith("status")) return ran(recorded(cli.fixture, "status.json"));
		if (command === "validate --all --strict --json")
			return ran(recorded(cli.fixture, "validate.json"), false);
		if (command.startsWith("validate")) return ran(recorded(cli.fixture, "validate.json"), false);
		return ran("unknown", false);
	};
	let now = 1_000_000;
	const clock = { advance: (ms: number) => (now += ms) };
	const board = new Board(t.host, { now: () => ++now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	const get = () => query<BoardView>("board.get", { projectId: "p1" });
	return { t, board, query, get, cli, clock };
}

const openspecCards = (view: BoardView) =>
	view.cards.filter((card) => card.source.kind === "openspec");

describe("the OpenSpec source", () => {
	test("without openspec/ in Default the board shows nothing of it and runs no CLI", async () => {
		const { t, board, get } = setup("in-progress");
		t.openspec.delete("w0");
		const view = await get();
		await board.idle();
		expect(view.openspec).toEqual({ present: false, cli: null, checking: false });
		expect(openspecCards(view)).toEqual([]);
		expect(t.runs).toEqual([]);
	});

	test("without the CLI it reads the files: a change is a virtual card in its stage's column", async () => {
		const { t, board, get, query, clock } = setup("in-progress");
		await query("settings.update", { projectId: "p1", preset: "spec-driven" });
		const first = await get();
		await board.idle();
		expect(t.runs).toEqual([{ workspaceId: "w0", argv: [...OPENSPEC_ARGV.version] }]);
		const view = await get();
		await board.idle();
		expect(t.runs).toHaveLength(1);
		expect(first.openspec.present).toBe(true);
		expect(view.openspec).toEqual({ present: true, cli: null, checking: false });
		expect(view.columns.filter((column) => !column.hidden).map((column) => column.id)).toEqual([
			"planning",
			"ready-to-apply",
			"in-progress",
			"complete",
			"archived",
		]);
		const [card] = openspecCards(view);
		expect(card).toMatchObject({
			id: "openspec:add-2fa-login",
			virtual: true,
			title: "Add TOTP two-factor login",
			description: "Add TOTP two-factor login",
			category: "started",
			column: "in-progress",
			source: { kind: "openspec", change: "add-2fa-login" },
			openspec: {
				change: "add-2fa-login",
				workspaceId: "w0",
				stage: "in-progress",
				tasks: { completed: 3, total: 7 },
				validation: null,
				source: "files",
			},
		});
		expect(card?.openspec?.artifacts.map((artifact) => artifact.status)).toEqual([
			"done",
			"done",
			"done",
			"done",
		]);
		expect(
			card?.openspec?.deltas.map(({ capability, added, modified, removed }) => [
				capability,
				added,
				modified,
				removed,
			]),
		).toEqual([
			["audit-log", 1, 0, 0],
			["auth", 2, 1, 0],
		]);
		clock.advance(PROBE_RETRY_MS);
		await get();
		await board.idle();
		expect(t.runs).toHaveLength(2);
	});

	test("with the CLI its list, status and validate are authoritative, read once per tree", async () => {
		const { t, board, get } = setup("invalid", { cli: "2.1.0" });
		await get();
		await board.idle();
		await get();
		await board.idle();
		const view = await get();
		await board.idle();
		expect(t.runs.map((run) => [run.workspaceId, run.argv.join(" ")])).toEqual([
			["w0", "openspec --version"],
			["w0", "openspec list --all --json --sort name"],
			["w0", "openspec status --all --json"],
			["w0", "openspec validate --all --strict --json"],
		]);
		expect(view.openspec).toEqual({ present: true, cli: "2.1.0", checking: false });
		expect(openspecCards(view)[0]?.openspec).toMatchObject({
			stage: "planning",
			source: "cli",
			validation: { valid: false, errors: 1, warnings: 1 },
			nextArtifact: "design",
		});
		t.openspec.set("w0", fixtureTree("planning"));
		await get();
		await board.idle();
		expect(t.runs).toHaveLength(7);
	});

	test("the spec-driven preset maps each stage's category onto its column", async () => {
		const { query, get } = setup("complete-archived");
		await query("settings.update", { projectId: "p1", preset: "spec-driven" });
		expect(openspecCards(await get()).map((card) => [card.id, card.column])).toEqual([
			["openspec:rate-limit-login", "complete"],
			["openspec:2026-11-19-add-refunds", "archived"],
		]);
		await query("settings.update", { projectId: "p1", preset: "agentic-kanban" });
		expect(openspecCards(await get()).map((card) => card.column)).toEqual(["review", "done"]);
	});

	test("moving or editing a change's card stores it once, linked to the change", async () => {
		const { query, get } = setup("ready");
		await get();
		await query("card.move", {
			cardId: "openspec:add-2fa-login",
			projectId: "p1",
			column: "backlog",
		});
		const view = await get();
		const cards = openspecCards(view);
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			id: "PA-1",
			source: { kind: "openspec", ref: "add-2fa-login", change: "add-2fa-login" },
			column: "backlog",
			openspec: { stage: "ready", tasks: { completed: 0, total: 7 } },
		});
		expect(cards[0]?.virtual).toBeUndefined();
		const detail = await query<CardDetail>("card.get", {
			cardId: "openspec:add-2fa-login",
			projectId: "p1",
		});
		expect(detail.card.id).toBe("PA-1");
		expect(detail.transitions[0]?.reason).toBe("created from the OpenSpec change add-2fa-login");
		expect(detail.card.openspec?.taskLines).toHaveLength(7);
		expect(detail.card.openspec?.requirements?.map((entry) => entry.name)).toContain(
			"Password login",
		);
		await expect(query("card.delete", { cardId: "openspec:add-2fa-login" })).rejects.toThrow(
			"stays while its change folder is there",
		);
	});

	test("Apply starts a workspace on the apply skill, carries the change there and marks x-thinkrail", async () => {
		const { t, query, get } = setup("ready");
		await get();
		const started = await query<{ card: Card; attempt: { workspaceId: string } }>("card.start", {
			cardId: "openspec:add-2fa-login",
			projectId: "p1",
		});
		expect(started.attempt.workspaceId).toBe("w1");
		expect(started.card).toMatchObject({ id: "PA-1", category: "started", column: "building" });
		const [created] = t.created;
		expect(created?.kickoff.text).toStartWith(
			"/skill:openspec-apply-change add-2fa-login\n\nCard PA-1: Add TOTP two-factor login\n\nApply the OpenSpec change add-2fa-login",
		);
		const written = new Map(t.writes.map((write) => [write.path, write]));
		expect(t.writes.every((write) => write.workspaceId === "w1")).toBe(true);
		expect([...written.keys()]).toEqual(
			expect.arrayContaining([
				"openspec/config.yaml",
				"openspec/specs/auth/spec.md",
				"openspec/changes/add-2fa-login/proposal.md",
				"openspec/changes/add-2fa-login/tasks.md",
				"openspec/changes/add-2fa-login/.openspec.yaml",
			]),
		);
		const metadata = written.get("openspec/changes/add-2fa-login/.openspec.yaml")?.content ?? "";
		expect(parseYaml(metadata)).toMatchObject({
			schema: "spec-driven",
			goal: "Add TOTP two-factor login",
			"x-thinkrail": { card: "PA-1", workspace: "w1" },
		});

		t.facts.set("w1", facts("w1", { chats: [] }));
		t.openspec.set("w1", fixtureTree("in-progress"));
		const live = openspecCards(await get());
		expect(live).toHaveLength(1);
		expect(live[0]?.openspec).toMatchObject({
			workspaceId: "w1",
			tasks: { completed: 3, total: 7 },
		});

		t.openspec.set("w1", {
			files: fixtureTree("in-progress").files.map((file) => ({
				...file,
				path: file.path.replace(
					"changes/add-2fa-login",
					"changes/archive/2026-11-20-add-2fa-login",
				),
			})),
		});
		expect(openspecCards(await get())[0]?.openspec).toMatchObject({
			stage: "archived",
			archived: true,
			workspaceId: "w1",
		});
	});

	test("an x-thinkrail write keeps the attempt's own copy of the change when its branch has it", async () => {
		const { t, query, get } = setup("ready");
		t.openspec.set("w1", fixtureTree("ready"));
		await get();
		await query("card.start", { cardId: "openspec:add-2fa-login", projectId: "p1" });
		expect(t.writes.map((write) => write.path)).toEqual([
			"openspec/changes/add-2fa-login/.openspec.yaml",
		]);
		expect(t.writes[0]?.content).toBe(
			recorded("ready", "x-thinkrail.openspec.yaml").replace("ws-apply", "w1"),
		);
	});

	test("Apply is refused for a change without tasks yet", async () => {
		const { t, query, get } = setup("planning");
		await get();
		await expect(
			query("card.start", { cardId: "openspec:add-webhook-retries", projectId: "p1" }),
		).rejects.toThrow("has no tasks yet");
		expect(t.created).toEqual([]);
	});

	test("Validate needs the CLI and runs it where the card reads its change", async () => {
		const offline = setup("invalid");
		await offline.get();
		await expect(
			offline.query("openspec.validate", { cardId: "openspec:drop-legacy-sms", projectId: "p1" }),
		).rejects.toThrow("npm install -g @fission-ai/openspec");

		const { t, board, query, get } = setup("invalid", { cli: "2.1.0" });
		await get();
		await board.idle();
		const verdict = await query<{ valid: boolean; errors: number; workspaceId: string }>(
			"openspec.validate",
			{ cardId: "openspec:drop-legacy-sms", projectId: "p1" },
		);
		expect(verdict).toMatchObject({
			change: "drop-legacy-sms",
			workspaceId: "w0",
			valid: false,
			errors: 1,
		});
		expect(t.runs).toContainEqual({
			workspaceId: "w0",
			argv: ["openspec", "validate", "drop-legacy-sms", "--strict", "--json"],
		});
	});

	test("Archive in workspace asks the apply chat to run openspec-archive-change and update the PR", async () => {
		const { t, board, query, get } = setup("ready", { cli: "2.1.0" });
		await get();
		await board.idle();
		await expect(
			query("openspec.archive", { cardId: "openspec:add-2fa-login", projectId: "p1" }),
		).rejects.toThrow("Apply the change first");
		await query("card.start", { cardId: "openspec:add-2fa-login", projectId: "p1" });
		t.facts.set(
			"w1",
			facts("w1", {
				chats: [
					{
						sessionId: "s1",
						title: "Apply",
						state: "finished",
						unread: false,
						plan: null,
						updatedAt: 1,
					},
				],
			}),
		);
		const asked = await query<{ sessionId: string; text: string }>("openspec.archive", {
			cardId: "PA-1",
		});
		expect(asked.sessionId).toBe("s1");
		expect(t.sent).toEqual([{ sessionId: "s1", text: asked.text, mode: "follow_up" }]);
		expect(asked.text).toStartWith(
			"Run openspec-archive-change add-2fa-login, then update the PR.",
		);
	});

	test("Propose starts a chat in Default on the propose skill with the description", async () => {
		const { t, query } = setup("empty");
		const started = await query<{ workspaceId: string; kickoff: string }>("openspec.propose", {
			projectId: "p1",
			description: "Add passkeys",
		});
		expect(started.workspaceId).toBe("w0");
		expect(t.chats[0]?.kickoff.text).toStartWith("/skill:openspec-propose Add passkeys\n\n");
		await expect(query("openspec.propose", { projectId: "p1" })).rejects.toThrow("description");
	});

	test("an unknown schema shows its reason instead of a guessed chain", async () => {
		const { get } = setup("edge-cases");
		const cards = openspecCards(await get());
		const byId = new Map(cards.map((card): [string, CardView] => [card.id, card]));
		expect(byId.get("openspec:mystery-schema")?.openspec).toMatchObject({
			artifacts: [],
			tasks: { completed: 1, total: 2 },
		});
		expect(byId.get("openspec:mystery-schema")?.openspec?.error).toContain("no-such-schema");
		expect(
			byId.get("openspec:custom-flow")?.openspec?.artifacts.map((artifact) => artifact.id),
		).toEqual(["research", "plan", "tasks"]);
	});
});
