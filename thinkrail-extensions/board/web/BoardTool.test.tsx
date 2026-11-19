import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardLayout, BoardView, Card } from "./api";
import { BoardBody, type BoardMode, shownColumns } from "./BoardTool";
import type { CardActions } from "./CardTile";
import { CardTile } from "./CardTile";
import { boardOf, cardOf, liveOf } from "./fixtures.test";

const noop = () => {};
const ACTIONS: CardActions = { open: noop, enter: noop, start: noop, keyDown: noop };

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

function tile(card: Card, starting = false): string {
	return html(
		<ul>
			<CardTile card={card} actions={ACTIONS} starting={starting} />
		</ul>,
	);
}

function body(view: BoardView, layout: BoardLayout, mode: BoardMode = "board"): string {
	return html(
		<BoardBody
			view={view}
			mode={mode}
			layout={layout}
			sort="column"
			actions={ACTIONS}
			starting={null}
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

	test("names the cards that block it", () => {
		expect(tile(cardOf({ blockedBy: ["TR-7", "TR-8"] }))).toContain("Blocked by TR-7, TR-8");
	});
});

describe("the board body", () => {
	const view = boardOf([
		cardOf(),
		cardOf({ id: "TR-2", title: "Done thing", column: "done", category: "completed", rank: 2 }),
	]);

	test("lays the columns side by side when wide and stacks them when narrow", () => {
		for (const layout of ["columns", "stacked"] as const) {
			const markup = body(view, layout);
			expect(markup.match(/data-testid="board-column"/g)).toHaveLength(6);
			expect(markup).toContain(layout === "columns" ? "w-208" : "flex flex-col gap-8");
			expect(markup).toContain('data-column="backlog"');
		}
		expect(body(view, "columns")).not.toContain("flex flex-col gap-8");
	});

	test("shows Triage only while it holds cards", () => {
		expect(shownColumns(view).map((column) => column.id)).not.toContain("triage");
		const triaged = boardOf([cardOf({ category: "triage", column: "triage" })]);
		expect(shownColumns(triaged).map((column) => column.id)).toContain("triage");
	});

	test("lists every card in a table in list mode, and invites a first card when empty", () => {
		const list = body(view, "columns", "list");
		expect(list).toContain('data-testid="board-list"');
		expect(list.match(/data-testid="board-list-row"/g)).toHaveLength(2);
		expect(body(boardOf([]), "columns")).toContain("No cards yet");
	});
});
