import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardView, Card, InboxItem } from "./api";
import { BoardBody, type CardsView, shownColumns } from "./BoardMain";
import type { CardActions } from "./CardTile";
import { CardTile } from "./CardTile";
import { boardOf, cardOf, fakeHost, liveOf } from "./fixtures.test";
import { InboxStrip } from "./Inbox";
import { type TriageActions, TriageLane } from "./Triage";

const noop = () => {};
const ACTIONS: CardActions = {
	open: noop,
	enter: noop,
	start: noop,
	adopt: noop,
	cancelStart: noop,
	keyDown: noop,
};
const TRIAGE: TriageActions = { accept: noop, dismiss: noop, open: noop };

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

function tile(card: Card, starting = false, startWarning: string | null = null): string {
	return html(
		<ul>
			<CardTile card={card} actions={ACTIONS} starting={starting} startWarning={startWarning} />
		</ul>,
	);
}

function body(view: BoardView, mode: CardsView = "board", filtered = false): string {
	return html(
		<BoardBody
			view={view}
			mode={mode}
			filtered={filtered}
			sort="column"
			actions={ACTIONS}
			triage={TRIAGE}
			starting={null}
			startWarning={null}
			onSort={noop}
			onDragEnd={noop}
			onNew={noop}
		/>,
	);
}

describe("a card tile", () => {
	test("shows its id, type, title, a suggested size and Start while it can start", () => {
		const markup = tile(cardOf({ size: "M", sizeSuggested: true }));
		expect(markup).toContain("TR-1");
		expect(markup).toContain("feature");
		expect(markup).toContain("Ship the board");
		expect(markup).toContain('data-suggested="true"');
		expect(markup).toContain("M?");
		expect(markup).toContain('data-testid="board-card-start"');
		expect(markup).not.toContain('data-testid="board-agent-badge"');
	});

	test("badges the agent's state from the overlay, with plan progress, diff and PR", () => {
		const states = [
			["working", "Working", false],
			["needs_you", "Waiting for you", false],
			["failed", "Failed", false],
			["finished", "Finished", false],
			["finished", "Finished · unread", true],
		] as const;
		for (const [state, label, unread] of states) {
			const markup = tile(
				cardOf({
					category: "started",
					column: "building",
					live: [
						liveOf({
							chat: { state, unread, title: "" },
							plan: { open: 2, total: 5 },
							diff: { added: 12, removed: 3 },
							pr: { kind: "pull-request", number: 42, state: "open" },
						}),
					],
				}),
			);
			expect(markup).toContain(label);
			expect(markup).toContain('max="5"');
			expect(markup).toContain("3/5");
			expect(markup).toContain("+12");
			expect(markup).toContain("#42 open");
			expect(markup).not.toContain('data-testid="board-card-start"');
		}
	});

	test("shows a working agent's last action under its badge, monospace and cut, and nothing once it stops", () => {
		const lastAction = { tool: "bash", target: "bun test thinkrail-extensions/board", at: 1 };
		const markup = tile(
			cardOf({
				category: "started",
				column: "building",
				live: [liveOf({ chat: { state: "working", unread: false, title: "", lastAction } })],
			}),
		);
		expect(markup).toContain('data-testid="board-last-action"');
		expect(markup).toContain('data-tool="bash"');
		expect(markup).toContain("tr-code-text-small");
		expect(markup).toContain("truncate");
		expect(markup).toContain("bun test thinkrail-extensions/board");
		expect(markup).toContain('title="Last action: bash bun test thinkrail-extensions/board"');
		expect(markup.indexOf("board-agent-badge")).toBeLessThan(markup.indexOf("board-last-action"));
		const settled = tile(
			cardOf({
				category: "review",
				column: "review",
				live: [liveOf({ chat: { state: "finished", unread: false, title: "", lastAction } })],
			}),
		);
		expect(settled).not.toContain('data-testid="board-last-action"');
	});

	test("names the cards that block it", () => {
		expect(tile(cardOf({ blockedBy: ["TR-7", "TR-8"] }))).toContain("Blocked by TR-7, TR-8");
	});
});

describe("the board body", () => {
	const view = boardOf([
		cardOf(),
		cardOf({ id: "TR-2", title: "Done thing", column: "done", category: "completed", rank: 2 }),
	]);

	test("lays the columns side by side at the center's full width", () => {
		const markup = body(view);
		expect(markup.match(/data-testid="board-column"/g)).toHaveLength(6);
		expect(markup).toContain("w-208");
		expect(markup).toContain('data-column="backlog"');
	});

	test("keeps Triage off the columns, as its own collapsed lane while it holds cards", () => {
		expect(shownColumns(view).map((column) => column.id)).not.toContain("triage");
		const triaged = boardOf([cardOf({ category: "triage", column: "triage" })]);
		expect(shownColumns(triaged).map((column) => column.id)).not.toContain("triage");
		expect(body(view)).not.toContain('data-testid="board-triage"');
		const lane = body(triaged);
		expect(lane).toContain('data-testid="board-triage"');
		expect(lane).toContain("Triage · 1");
		expect(lane).not.toContain('data-testid="board-triage-group"');
		const canceled = boardOf([cardOf({ category: "canceled", column: "canceled" })]);
		expect(shownColumns(canceled).map((column) => column.id)).toContain("canceled");
	});

	test("shows the Review limit on a Review column, marked once the count is past it", () => {
		const reviewing = boardOf(
			[
				cardOf({ category: "review", column: "review" }),
				cardOf({ id: "TR-2", category: "review", column: "review" }),
			],
			{
				wip: {
					needsYou: { count: 0, limit: 3 },
					review: { count: 2, limit: 1 },
					agents: { count: 0, limit: 3 },
				},
			},
		);
		const markup = body(reviewing);
		expect(markup.match(/data-testid="board-column-wip"/g)).toHaveLength(1);
		expect(markup).toContain('data-testid="board-column-wip" data-over="true"');
		expect(markup).toContain("2/1");
		expect(body(view)).not.toContain('data-over="true"');
	});

	test("lists every card in a table in list mode, and invites a first card when empty", () => {
		const list = body(view, "list");
		expect(list).toContain('data-testid="board-list"');
		expect(list.match(/data-testid="board-list-row"/g)).toHaveLength(2);
		expect(body(boardOf([]))).toContain("No cards yet");
		expect(body(boardOf([]), "board", true)).toContain("No cards match the filters.");
	});
});

describe("Start past a human-attention limit", () => {
	test("asks instead of offering Start, with Start anyway", () => {
		const markup = tile(
			cardOf(),
			false,
			"Review is over its limit (6/5) — finish before starting?",
		);
		expect(markup).toContain('data-testid="board-start-warning"');
		expect(markup).toContain("Review is over its limit (6/5)");
		expect(markup).toContain('data-testid="board-start-anyway"');
		expect(markup).not.toContain('data-testid="board-card-start"');
	});
});

describe("the triage lane", () => {
	test("is collapsed to its count by default and absent while Triage is empty", () => {
		const view = boardOf([
			cardOf({ id: "TR-5", category: "triage", column: "triage", size: "S", sizeSuggested: true }),
		]);
		const markup = html(<TriageLane view={view} actions={TRIAGE} />);
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain("Triage · 1");
		expect(html(<TriageLane view={boardOf([])} actions={TRIAGE} />)).toBe("");
	});
});

describe("the inbox strip", () => {
	const item = (reason: InboxItem["reason"], id: string): InboxItem => ({
		projectId: "p2",
		projectName: "payments-api",
		reason,
		card: cardOf({
			id,
			category: "started",
			column: "building",
			live: [liveOf({ chat: { state: reason, unread: false, title: "" } })],
		}),
	});

	test("lists each card with its project, id, reason, Answer or Retry and Open workspace; nothing when empty", () => {
		const { host } = fakeHost();
		const markup = html(
			<InboxStrip host={host} items={[item("needs_you", "PA-1"), item("failed", "PA-2")]} />,
		);
		expect(markup).toContain("Needs you · 2");
		expect(markup).toContain("payments-api");
		expect(markup).toContain("Question pending");
		expect(markup).toContain("Failed");
		expect(markup).toContain("Answer");
		expect(markup).toContain("Retry");
		expect(markup.match(/data-testid="board-inbox-row"/g)).toHaveLength(2);
		expect(markup.match(/data-testid="board-inbox-workspace"/g)).toHaveLength(2);
		expect(html(<InboxStrip host={host} items={[]} />)).toBe("");
	});
});
