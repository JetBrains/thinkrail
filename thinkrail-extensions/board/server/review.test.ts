import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import type { ExtensionQuery } from "@thinkrail/extension-api/server";
import { Board, type CardDetail } from "./board";
import type { Card, ReviewItem, Transition } from "./model";
import { fixtureTree } from "./openspec/fixtureTree";
import { boardQueries } from "./queries";
import {
	assembleRequirements,
	duration,
	PACKET_END,
	PACKET_START,
	type Packet,
	packetOf,
	productRequirements,
	reviewItems,
	SMART_REVIEW_AUTHOR,
	tally,
	timeSplit,
	unmetComments,
	upsertPacket,
} from "./review";
import { createTestHost, facts, project, ran, type TestHost } from "./testHost";

describe("requirement assembly", () => {
	test("criteria, then each task-spec's Product bullets, then the change's delta requirements, with stable ids", () => {
		const requirements = assembleRequirements({
			acceptance: ["Greets in French", " ", "Says goodbye"],
			products: [
				{
					specId: "task-greet",
					section:
						"- **Conformance.** Each item is met or unmet:\n  - its criteria;\n  - its spec.\n- [x] Done already\n- none\n- Packet on the card",
				},
			],
			openspec: [
				{
					capability: "auth",
					operation: "ADDED",
					name: "TOTP enrollment",
					text: "The system SHALL enroll TOTP.",
					scenarios: [{ name: "a user scans", text: "- **WHEN** scanned\n- **THEN** enrolled" }],
				},
				{ capability: "auth", operation: "REMOVED", name: "SMS login" },
			],
		});
		expect(requirements).toEqual([
			{ id: "ac-1", source: "criterion", text: "Greets in French" },
			{ id: "ac-2", source: "criterion", text: "Says goodbye" },
			{
				id: "spec-task-greet-1",
				source: "task-spec",
				text: "Conformance. Each item is met or unmet:\n- its criteria;\n- its spec.",
			},
			{ id: "spec-task-greet-2", source: "task-spec", text: "Packet on the card" },
			{
				id: "os-auth-totp-enrollment",
				source: "openspec",
				text: 'ADDED requirement "TOTP enrollment" (auth): The system SHALL enroll TOTP.',
				scenarios: ["a user scans\n- **WHEN** scanned\n- **THEN** enrolled"],
			},
			{
				id: "os-auth-sms-login",
				source: "openspec",
				text: 'REMOVED requirement "SMS login" (auth): it is gone from the code, nothing still relies on it',
			},
		]);
		expect(
			assembleRequirements({ acceptance: ["Greets in French"], products: [], openspec: [] }),
		).toEqual(requirements.slice(0, 1));
		expect(productRequirements("task-greet", "Prose only, no bullets.")).toEqual([]);
	});

	test("a recorded OpenSpec change's requirements carry their statements and scenarios", async () => {
		const { parseOpenspec } = await import("./openspec");
		const change = parseOpenspec(fixtureTree("in-progress")).find(
			(candidate) => candidate.name === "add-2fa-login",
		);
		const requirements = assembleRequirements({
			acceptance: [],
			products: [],
			openspec: change?.requirements ?? [],
		});
		expect(requirements.map((requirement) => requirement.id)).toEqual([
			"os-audit-log-security-events",
			"os-auth-totp-enrollment",
			"os-auth-recovery-codes",
			"os-auth-password-login",
		]);
		expect(requirements[1]?.scenarios?.[0]).toContain("**WHEN** a user scans the QR code");
	});
});

const items: ReviewItem[] = [
	{
		id: "ac-1",
		source: "criterion",
		text: "Greets in French",
		verdict: "met",
		evidence: [{ path: "src/greet.ts", line: 3, note: "bonjour" }],
		tests: ["src/greet.test.ts"],
	},
	{
		id: "ac-2",
		source: "criterion",
		text: "Says goodbye | politely",
		verdict: "unmet",
		evidence: [
			{ path: "src/greet.ts", note: "no farewell" },
			{ path: "/elsewhere/greet.ts", line: 2, note: "outside" },
			{ path: "src/greet.ts", line: 9, note: "should be here" },
		],
		tests: [],
	},
	{
		id: "ac-3",
		source: "criterion",
		text: "Logs the greeting",
		verdict: "unmet",
		evidence: [{ path: "src/log.ts", note: "missing" }],
		tests: [],
	},
	{
		id: "ac-4",
		source: "criterion",
		text: "Is fast",
		verdict: "untested",
		evidence: [],
		tests: [],
	},
];

test("only unmet items with a line become comments, on their first evidence line", () => {
	expect(unmetComments(items)).toEqual([
		{
			itemId: "ac-2",
			comment: {
				path: "src/greet.ts",
				line: 9,
				side: "worktree",
				text: "Unmet requirement: Says goodbye | politely\n\nshould be here",
			},
		},
	]);
	expect(tally(items)).toEqual({ met: 1, unmet: 2, untested: 1, total: 4 });
});

test("verdicts join their requirements in order; a requirement the reviewer skipped reads untested", () => {
	const joined = reviewItems(
		[
			{ id: "ac-1", source: "criterion", text: "A" },
			{ id: "ac-2", source: "criterion", text: "B" },
		],
		{ items: [{ id: "ac-2", verdict: "met", evidence: [], tests: ["t"] }], summary: "" },
	);
	expect(joined.map((item) => [item.id, item.verdict, item.tests])).toEqual([
		["ac-1", "untested", []],
		["ac-2", "met", ["t"]],
	]);
});

test("the time split counts started as the agent and review as waiting, an open span until now", () => {
	const at = (category: string | null, time: number): Transition => ({
		cardId: "TR-1",
		from: null,
		to: category ? { category: category as never, column: category } : null,
		at: time,
		actor: "automation",
		reason: "",
	});
	expect(
		timeSplit(
			[at("started", 0), at("review", 60_000), at("started", 90_000), at("review", 150_000)],
			200_000,
		),
	).toEqual({ agentMs: 120_000, waitingMs: 80_000 });
	expect(duration(125 * 60_000)).toBe("2h 05m");
	expect(duration(35 * 60_000)).toBe("35m");
	expect(duration(120 * 60_000)).toBe("2h");
});

describe("the review packet", () => {
	const input = {
		card: { id: "TR-3", title: "Greet in French", description: "Users in France get a greeting." },
		initiative: { id: "I-1", title: "Launch in France", outcome: "French users stay." },
		plan: {
			summary: "Greeting shipped.",
			steps: [
				{
					title: "Write the greeting",
					status: "done" as const,
					summary: "Added bonjour",
					verification: "bun test — 3 pass",
				},
				{ title: "Tidy", status: "pending" as const },
			],
		},
		review: { at: Date.UTC(2026, 0, 2), summary: "One requirement is missing.", items },
		diff: { added: 12, removed: 3 },
		time: { agentMs: 125 * 60_000, waitingMs: 35 * 60_000 },
	};

	test("renders why, what, how it was verified, the conformance table and the time — the same bytes each time", () => {
		const packet: Packet = packetOf(input);
		expect(packetOf(input).markdown).toBe(packet.markdown);
		expect(packet.markdown).toBe(
			[
				"## Review packet",
				"",
				"**TR-3 · Greet in French**",
				"",
				"### Why",
				"",
				"- **Outcome** (I-1 · Launch in France): French users stay.",
				"- **Goal:** Users in France get a greeting.",
				"",
				"### What",
				"",
				"Greeting shipped.",
				"",
				"- [x] Write the greeting — Added bonjour",
				"- [ ] Tidy",
				"",
				"### How it was verified",
				"",
				"- **Write the greeting:** bun test — 3 pass",
				"",
				"### Conformance",
				"",
				"One requirement is missing.",
				"",
				"| Requirement | Verdict | Evidence | Tests |",
				"| --- | --- | --- | --- |",
				"| Greets in French | ✅ met | `src/greet.ts:3` bonjour | `src/greet.test.ts` |",
				"| Says goodbye \\| politely | ❌ unmet | `src/greet.ts` no farewell<br>`/elsewhere/greet.ts:2` outside<br>`src/greet.ts:9` should be here | — |",
				"| Logs the greeting | ❌ unmet | `src/log.ts` missing | — |",
				"| Is fast | ⚠️ untested | — | — |",
				"",
				"Met 1/4 · unmet 2 · untested 1 · reviewed 2026-01-02",
				"",
				"### Time",
				"",
				"Agent 2h 05m · waiting for review 35m · diff +12 −3",
				"",
				"_The smart review is advisory: it approves nothing, and a human merges._",
			].join("\n"),
		);
		expect(packet.conformance?.tally).toEqual({ met: 1, unmet: 2, untested: 1, total: 4 });
		expect(packet.verified).toEqual([
			{ title: "Write the greeting", verification: "bun test — 3 pass" },
		]);
	});

	test("agent text carrying HTML comments or the markers is made inert, so the upsert keeps finding its own pair", () => {
		const summary = `Checked.\n${PACKET_START}\nold packet\n${PACKET_END} <!-- note -->`;
		const marked = (text: string) =>
			packetOf({
				...input,
				plan: { ...input.plan, summary: `Shipped ${PACKET_END}` },
				review: { ...input.review, summary: text },
			}).markdown;
		const markdown = marked(summary);
		expect(markdown).not.toContain("<!--");
		expect(markdown).not.toContain("-->");
		expect(markdown).toContain("&lt;!-- thinkrail:review-packet --&gt;");
		expect(markdown).toContain("Shipped &lt;!-- /thinkrail:review-packet --&gt;");
		const once = upsertPacket("Adds the greeting.\n", markdown);
		expect(once.split(PACKET_START)).toHaveLength(2);
		expect(upsertPacket(once, markdown)).toBe(once);
		const again = upsertPacket(once, marked(`${summary} Again.`));
		expect(again.split(PACKET_START)).toHaveLength(2);
		expect(again.split("old packet")).toHaveLength(2);
		expect(again).toContain("Again.");
	});

	test("without a plan or a review it says so", () => {
		const { markdown } = packetOf({ ...input, plan: null, review: undefined, diff: null });
		expect(markdown).toContain("_No plan recorded._");
		expect(markdown).toContain("_No verification recorded._");
		expect(markdown).toContain("_Not reviewed yet._");
		expect(markdown).not.toContain("diff +");
	});
});

describe("the PR body upsert", () => {
	const section = "## Review packet\n\nMet 1/1";

	test("appends one marked section once, then only ever replaces what is between the markers", () => {
		const body = "Adds the greeting.\n\nCloses #8\n";
		const once = upsertPacket(body, section);
		expect(once).toBe(
			`Adds the greeting.\n\nCloses #8\n\n${PACKET_START}\n${section}\n${PACKET_END}\n`,
		);
		expect(upsertPacket(once, section)).toBe(once);
		const edited = once.replace("Adds the greeting.", "Adds the French greeting.");
		const again = upsertPacket(
			`${edited}\nA reviewer's note after it.\n`,
			"## Review packet\n\nMet 2/2",
		);
		expect(again).toBe(
			`Adds the French greeting.\n\nCloses #8\n\n${PACKET_START}\n## Review packet\n\nMet 2/2\n${PACKET_END}\n\nA reviewer's note after it.\n`,
		);
		expect(upsertPacket("", section)).toBe(`${PACKET_START}\n${section}\n${PACKET_END}\n`);
	});

	test("an unclosed marker earlier in the body is left alone", () => {
		const body = `Intro ${PACKET_START} quoted.\n`;
		const once = upsertPacket(body, section);
		expect(once.startsWith(`Intro ${PACKET_START} quoted.`)).toBe(true);
		expect(upsertPacket(once, section)).toBe(once);
	});
});

const hosts: TestHost[] = [];
afterEach(() => {
	for (const t of hosts.splice(0)) rmSync(t.root, { recursive: true, force: true });
});

function setup() {
	const t = createTestHost();
	hosts.push(t);
	t.projects.splice(
		0,
		1,
		project("p1", "ThinkRail", [{ id: "w0", name: "Default", kind: "default", branch: "main" }]),
	);
	let now = 1_000_000;
	const board = new Board(t.host, { now: () => ++now, owner: "dana", sizeDelayMs: 0 });
	const queries = boardQueries(board);
	const query = async <T>(method: string, params?: unknown): Promise<T> =>
		(await (queries[method] as ExtensionQuery)(params)) as T;
	return { t, board, query };
}

async function startedCard(t: TestHost, query: ReturnType<typeof setup>["query"]): Promise<Card> {
	const created = await query<Card>("card.create", {
		projectId: "p1",
		title: "Greet in French",
		description: "Users in France get a greeting.",
		acceptance: ["Greets in French", "Says goodbye", "Logs the greeting"],
		size: "S",
	});
	await query("card.start", { cardId: created.id });
	t.facts.set("w1", facts("w1", { diff: { added: 12, removed: 3 } }));
	return created;
}

const verdicts = {
	summary: "Two requirements are missing.",
	items: [
		{
			id: "ac-1",
			verdict: "met" as const,
			evidence: [{ path: "greet.ts", line: 1, note: "bonjour" }],
			tests: ["greet.test.ts"],
		},
		{
			id: "ac-2",
			verdict: "unmet" as const,
			evidence: [{ path: "greet.ts", line: 4, note: "no farewell" }],
			tests: [],
		},
		{
			id: "ac-3",
			verdict: "unmet" as const,
			evidence: [{ path: "log.ts", note: "missing" }],
			tests: [],
		},
	],
};

describe("Smart review on a card", () => {
	test("card.review checks the latest attempt against its requirements, stores the verdicts and comments the unmet lines", async () => {
		const { t, board, query } = setup();
		const card = await startedCard(t, query);
		t.taskSpecs.set("w1", [
			{
				id: "task-greet",
				title: "Greet",
				status: "active",
				path: ".thinkrail/context/TASK-greet.md",
			},
		]);
		t.sections.set("w1:task-greet:Product", "- The greeting is French");
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		t.reviewer.answer = async () => {
			await held;
			return {
				...verdicts,
				items: [
					...verdicts.items,
					{ id: "spec-task-greet-1", verdict: "untested", evidence: [], tests: [] },
				],
			};
		};
		expect(await query("card.review", { cardId: card.id })).toEqual({
			cardId: card.id,
			requirements: 4,
		});
		expect((await query<CardDetail>("card.get", { cardId: card.id })).card.reviewing).toBe(true);
		await expect(query("card.review", { cardId: card.id })).rejects.toThrow(
			"being reviewed already",
		);
		release();
		await board.idle();
		expect(t.reviews).toHaveLength(1);
		expect(t.reviews[0]).toMatchObject({ workspaceId: "w1", sessionId: "s1" });
		expect(t.reviews[0]?.requirements.map((requirement) => requirement.id)).toEqual([
			"ac-1",
			"ac-2",
			"ac-3",
			"spec-task-greet-1",
		]);
		expect(t.reviews[0]?.context).toContain(`Card ${card.id}: Greet in French`);
		expect(t.comments).toEqual([
			{
				workspaceId: "w1",
				author: SMART_REVIEW_AUTHOR,
				comments: [
					{
						path: "greet.ts",
						line: 4,
						side: "worktree",
						text: "Unmet requirement: Says goodbye\n\nno farewell",
					},
				],
			},
		]);
		const { card: reviewed } = await query<CardDetail>("card.get", { cardId: card.id });
		expect(reviewed.reviewing).toBeUndefined();
		const review = reviewed.attempts[0]?.review;
		expect(review?.summary).toBe("Two requirements are missing.");
		expect(review?.items.map((item) => [item.id, item.verdict, item.commentId])).toEqual([
			["ac-1", "met", undefined],
			["ac-2", "unmet", "rc_1"],
			["ac-3", "unmet", undefined],
			["spec-task-greet-1", "untested", undefined],
		]);
		expect(t.published.filter((push) => push.type === "board.changed").length).toBeGreaterThan(2);
		expect(board.find(card.id).attempts[0]?.review?.items).toHaveLength(4);

		t.reviewer.answer = async () => verdicts;
		t.sections.clear();
		await query("card.review", { cardId: card.id });
		await board.idle();
		expect(t.comments).toHaveLength(1);
		expect(board.find(card.id).attempts[0]?.review?.items[1]?.commentId).toBe("rc_1");
	});

	test("card.review refuses a card with no attempt, a closed workspace, nothing to check; a failure stays on the card", async () => {
		const { t, board, query } = setup();
		const bare = await query<Card>("card.create", { projectId: "p1", title: "Nothing" });
		await expect(query("card.review", { cardId: bare.id })).rejects.toThrow("no attempt");
		await query("card.start", { cardId: bare.id });
		await expect(query("card.review", { cardId: bare.id })).rejects.toThrow("not open");
		t.facts.set("w1", facts("w1"));
		await expect(query("card.review", { cardId: bare.id })).rejects.toThrow("nothing to check");
		await expect(query("card.review", {})).rejects.toThrow();
		expect(t.reviews).toEqual([]);
		const card = await startedCard(t, query);
		t.facts.set("w2", facts("w2"));
		t.reviewer.answer = async () => {
			throw new Error("The conformance reviewer did not complete (aborted).");
		};
		await query("card.review", { cardId: card.id });
		await board.idle();
		const { card: failed } = await query<CardDetail>("card.get", { cardId: card.id });
		expect(failed.reviewError).toContain("did not complete");
		expect(failed.attempts[0]?.review).toBeUndefined();
		expect(t.comments).toEqual([]);
	});

	test("card.packet is built from host facts: the plan's steps and verifications, the review, the diff", async () => {
		const { t, board, query } = setup();
		const card = await startedCard(t, query);
		t.plans.set("w1:s1", {
			summary: "Greeting shipped.",
			steps: [
				{
					title: "Write the greeting",
					status: "done",
					summary: "Added bonjour",
					verification: "bun test",
				},
			],
		});
		t.reviewer.answer = async () => verdicts;
		await query("card.review", { cardId: card.id });
		await board.idle();
		const packet = await query<Packet>("card.packet", { cardId: card.id });
		expect(packet.what.steps).toEqual([
			{ title: "Write the greeting", status: "done", summary: "Added bonjour" },
		]);
		expect(packet.verified).toEqual([{ title: "Write the greeting", verification: "bun test" }]);
		expect(packet.conformance?.tally).toEqual({ met: 1, unmet: 2, untested: 0, total: 3 });
		expect(packet.diff).toEqual({ added: 12, removed: 3 });
		expect(packet.markdown).toContain("Met 1/3");
		expect(packet.markdown).toContain("- **Goal:** Users in France get a greeting.");
	});

	test("card.packetToPr upserts the section through gh once, refuses without a PR, and touches nothing else", async () => {
		const { t, board, query } = setup();
		const card = await startedCard(t, query);
		await expect(query("card.packetToPr", { cardId: card.id })).rejects.toThrow("no pull request");
		t.facts.set(
			"w1",
			facts("w1", {
				review: { kind: "pull-request", number: 31, state: "open", url: "https://example.test/31" },
			}),
		);
		const pr = { body: "Adds the greeting.\n\nCloses #8" };
		const edits: string[][] = [];
		t.run.answer = (argv) => {
			if (argv[1] === "pr" && argv[2] === "view") return ran(JSON.stringify({ body: pr.body }));
			if (argv[1] === "pr" && argv[2] === "edit") {
				edits.push([...argv]);
				pr.body = readFileSync(argv[argv.indexOf("--body-file") + 1] ?? "", "utf8");
				return ran("");
			}
			return ran("unexpected", false);
		};
		t.reviewer.answer = async () => verdicts;
		await query("card.review", { cardId: card.id });
		await board.idle();
		expect(await query("card.packetToPr", { cardId: card.id })).toEqual({
			cardId: card.id,
			pr: 31,
			url: "https://example.test/31",
			updated: true,
		});
		expect(edits.map((argv) => argv.slice(0, 5))).toEqual([
			["gh", "pr", "edit", "31", "--body-file"],
		]);
		expect(
			pr.body.startsWith(`Adds the greeting.\n\nCloses #8\n\n${PACKET_START}\n## Review packet`),
		).toBe(true);
		expect(pr.body.endsWith(`${PACKET_END}\n`)).toBe(true);
		expect(t.runs.every((run) => run.workspaceId === "w1")).toBe(true);
		expect(
			(await query<{ updated: boolean }>("card.packetToPr", { cardId: card.id })).updated,
		).toBe(false);
		expect(edits).toHaveLength(1);
		t.run.answer = () => ran("gh: HTTP 502", false);
		await expect(query("card.packetToPr", { cardId: card.id })).rejects.toThrow("HTTP 502");
	});
});
