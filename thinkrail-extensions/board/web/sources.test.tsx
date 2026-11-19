import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type Card,
	canAdopt,
	canStart,
	openTaskSpec,
	sendDeferrals,
	setGithub,
	shownId,
	type TaskSpecRef,
	triageGroups,
} from "./api";
import { GithubBanner, GithubMenu } from "./BoardTool";
import { IssueLink, TaskSpecCardDetails, TaskSpecs } from "./CardPanel";
import { type CardActions, CardTile } from "./CardTile";
import { boardOf, cardOf, fakeHost, liveOf } from "./fixtures.test";
import { GITHUB_PROBLEMS } from "./labels";

const noop = () => {};
const ACTIONS: CardActions = {
	open: noop,
	enter: noop,
	start: noop,
	adopt: noop,
	cancelStart: noop,
	keyDown: noop,
};

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const tile = (card: Card) =>
	html(
		<ul>
			<CardTile card={card} actions={ACTIONS} starting={false} />
		</ul>,
	);

const ref = (overrides: Partial<TaskSpecRef> = {}): TaskSpecRef => ({
	kind: "task-spec",
	workspaceId: "w0",
	id: "task-x",
	title: "Task X",
	status: "draft",
	path: ".thinkrail/context/TASK-x.md",
	...overrides,
});

const specCard = cardOf({
	id: "spec:w2:task-x",
	source: {
		kind: "task-spec",
		ref: "task-x",
		workspaceId: "w2",
		path: ".thinkrail/context/TASK-x.md",
	},
	title: "Task X",
	category: "started",
	column: "building",
	taskSpecs: [ref({ workspaceId: "w2" })],
	live: [liveOf({ workspaceId: "w2" })],
	virtual: true,
});

const issueCard = cardOf({
	id: "#7",
	source: { kind: "github", ref: "#7", number: 7, url: "https://github.com/acme/app/issues/7" },
	title: "Crash on an empty board",
	type: "bug",
	virtual: true,
});

describe("source cards", () => {
	test("a task-spec's card is adopted, never started or dragged; an issue's card starts", () => {
		expect(canAdopt(specCard)).toBe(true);
		expect(canStart(specCard)).toBe(false);
		expect(canAdopt(issueCard)).toBe(false);
		expect(canStart(issueCard)).toBe(true);
		expect(canAdopt(cardOf({ source: specCard.source }))).toBe(false);
		expect(shownId(specCard)).toBe("task-x");
		expect(shownId(issueCard)).toBe("#7");
	});

	test("tiles badge their source and offer Adopt on a task-spec's card, Start on an issue's", () => {
		const spec = tile(specCard);
		expect(spec).toContain('data-source="task-spec"');
		expect(spec).toContain('data-virtual="true"');
		expect(spec).toContain('data-testid="board-card-adopt"');
		expect(spec).toContain(">Adopt<");
		expect(spec).not.toContain('data-testid="board-card-start"');
		expect(spec).not.toContain('data-testid="board-task-spec"');
		expect(spec).toContain('data-testid="board-task-spec-status"');
		expect(spec).toContain('data-status="draft"');
		expect(spec).toContain(">task-x<");
		expect(spec).not.toContain("spec:w2:task-x<");

		const issue = tile(issueCard);
		expect(issue).toContain('data-testid="board-source"');
		expect(issue).toContain('data-source="github"');
		expect(issue).toContain(">GitHub<");
		expect(issue).toContain("#7");
		expect(issue).toContain('data-testid="board-card-start"');
		expect(issue).not.toContain('data-testid="board-card-adopt"');

		const bound = tile(
			cardOf({ taskSpecs: [ref({ status: "active" }), ref({ id: "task-y", status: "done" })] }),
		);
		expect(bound.match(/data-testid="board-task-spec"/g)).toHaveLength(2);
		expect(bound).toContain('data-status="active"');
		expect(bound).toContain('data-status="done"');
		expect(bound).not.toContain('data-testid="board-source"');
	});

	test("a card's task-specs open in Peek here and in their own workspace elsewhere, and send deferrals", () => {
		const { host } = fakeHost();
		const stored = html(
			<TaskSpecs
				host={host}
				card={cardOf({ taskSpecs: [ref(), ref({ id: "task-y", workspaceId: "w9" })] })}
				onSent={noop}
			/>,
		);
		expect(stored).toContain('data-target="peek"');
		expect(stored).toContain('data-target="workspace"');
		expect(stored).toContain("Open in its workspace");
		expect(stored.match(/data-testid="board-task-spec-deferrals"/g)).toHaveLength(2);
		expect(stored).toContain("Send deferrals to Triage");
		const virtual = html(<TaskSpecs host={host} card={specCard} onSent={noop} />);
		expect(virtual).not.toContain("board-task-spec-deferrals");

		const opened = fakeHost();
		expect(openTaskSpec(opened.host, ref())).toBe("peek");
		expect(openTaskSpec(opened.host, ref({ workspaceId: "w9", path: "docs/TASK-y.md" }))).toBe(
			"file",
		);
		expect(opened.peeks).toEqual([{ kind: "file", path: ".thinkrail/context/TASK-x.md" }]);
		expect(opened.files).toEqual([{ workspaceId: "w9", path: "docs/TASK-y.md" }]);
	});

	test("a task-spec's card in Peek offers Adopt; an issue's card links its issue", () => {
		const { host } = fakeHost();
		const panel = html(
			<TaskSpecCardDetails
				host={host}
				detail={{ projectId: "p1", card: specCard, transitions: [] }}
				onAdopted={noop}
			/>,
		);
		expect(panel).toContain('data-testid="board-card-panel-adopt"');
		expect(panel).toContain("A task-spec in a workspace no card holds.");
		expect(panel).toContain('data-testid="board-card-task-spec"');
		const link = html(<IssueLink card={issueCard} />);
		expect(link).toContain('href="https://github.com/acme/app/issues/7"');
		expect(link).toContain("Issue #7 on GitHub");
		expect(link).toContain("Not on the board yet");
		expect(html(<IssueLink card={cardOf()} />)).toBe("");
	});

	test("Send deferrals and Show GitHub issues read the host's answers", async () => {
		const answers: Record<string, unknown> = {
			"card.deferrals": { created: [{ id: "TR-2" }, { id: "TR-3" }], skipped: 1 },
			"github.set": { problem: "unauthenticated", settings: {} },
		};
		const { host, queries } = fakeHost((method) => answers[method]);
		expect(await sendDeferrals(host, "TR-1", "task-x")).toEqual({ created: 2, skipped: 1 });
		expect(await setGithub(host, "p1", { enabled: true })).toEqual({ problem: "unauthenticated" });
		expect(queries).toEqual([
			{ method: "card.deferrals", params: { cardId: "TR-1", specId: "task-x" } },
			{ method: "github.set", params: { projectId: "p1", enabled: true } },
		]);
		answers["github.set"] = { problem: null };
		expect(await setGithub(host, "p1", { enabled: true })).toEqual({ problem: null });
		expect(GITHUB_PROBLEMS.unauthenticated).toBe("board.github.problem.unauthenticated");
	});

	test("the GitHub menu shows the source's state and a failed fetch is a banner", () => {
		const github = boardOf([]).github;
		const off = html(<GithubMenu github={github} onShow={noop} onFilter={noop} onRefresh={noop} />);
		expect(off).toContain('data-testid="board-github-menu"');
		expect(off).toContain('aria-label="GitHub issues"');
		expect(off).not.toContain("data-enabled");
		const on = html(
			<GithubMenu
				github={{ ...github, enabled: true }}
				onShow={noop}
				onFilter={noop}
				onRefresh={noop}
			/>,
		);
		expect(on).toContain('data-enabled="true"');
		expect(html(<GithubBanner github={github} onRefresh={noop} onDismiss={noop} />)).toBe("");
		const banner = html(
			<GithubBanner
				github={{ ...github, enabled: true, error: "HTTP 401: Bad credentials" }}
				onRefresh={noop}
				onDismiss={noop}
			/>,
		);
		expect(banner).toContain('data-testid="board-github-error"');
		expect(banner).toContain("Couldn&#x27;t fetch GitHub issues: HTTP 401: Bad credentials");
		expect(banner).toContain('data-testid="board-github-retry"');
	});

	test("Triage groups a card's deferrals apart from an agent's filings", () => {
		const view = boardOf([
			cardOf({ id: "TR-2", category: "triage", column: "triage", origin: { cardId: "TR-1" } }),
			cardOf({
				id: "TR-3",
				category: "triage",
				column: "triage",
				origin: { sessionId: "s1", cardId: "TR-1" },
				createdBy: "agent",
			}),
			cardOf({ id: "TR-4", category: "triage", column: "triage", origin: { cardId: "TR-1" } }),
		]);
		expect(
			triageGroups(view).map(({ key, kind, cardId, cards }) => [
				key,
				kind,
				cardId,
				cards.map((card) => card.id),
			]),
		).toEqual([
			["card:TR-1", "deferrals", "TR-1", ["TR-2", "TR-4"]],
			["s1", "chat", "TR-1", ["TR-3"]],
		]);
	});
});
