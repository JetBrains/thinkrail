import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	archiveChange,
	type Card,
	canApply,
	canArchive,
	canStart,
	deltaText,
	type OpenspecOverlay,
	openChangeFile,
	presetsFor,
	proposeChange,
	shownId,
	validateChange,
} from "./api";
import { type CardActions, CardTile } from "./CardTile";
import { boardOf, cardOf, fakeHost, liveOf } from "./fixtures.test";
import { OpenspecSection } from "./OpenspecParts";

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

const artifacts = (statuses: OpenspecOverlay["artifacts"][number]["status"][]) =>
	["proposal", "specs", "design", "tasks"].map((id, index) => ({
		id,
		status: statuses[index] ?? "blocked",
		files: statuses[index] === "done" ? [`openspec/changes/add-2fa-login/${id}.md`] : [],
	}));

function overlay(overrides: Partial<OpenspecOverlay> = {}): OpenspecOverlay {
	return {
		change: "add-2fa-login",
		workspaceId: "w0",
		dir: "openspec/changes/add-2fa-login",
		archived: false,
		stage: "in-progress",
		schema: "spec-driven",
		artifacts: artifacts(["done", "done", "done", "done"]),
		nextArtifact: null,
		tasks: { completed: 3, total: 7 },
		deltas: [
			{
				capability: "auth",
				path: "openspec/changes/add-2fa-login/specs/auth/spec.md",
				added: 2,
				modified: 1,
				removed: 0,
				renamed: 0,
			},
		],
		validation: null,
		source: "files",
		...overrides,
	};
}

const changeCard = (change: Partial<OpenspecOverlay> = {}, card: Partial<Card> = {}) =>
	cardOf({
		id: "openspec:add-2fa-login",
		source: { kind: "openspec", ref: "add-2fa-login", change: "add-2fa-login" },
		title: "Add TOTP two-factor login",
		category: "started",
		column: "in-progress",
		virtual: true,
		openspec: overlay(change),
		...card,
	});

/** The same change's card once stored as PA-1. */
const storedCard = (change: Partial<OpenspecOverlay> = {}, card: Partial<Card> = {}) => {
	const { virtual: _virtual, ...stored } = changeCard(change, { id: "PA-1", ...card });
	return stored;
};

describe("the spec-driven preset", () => {
	test("is offered only while Default has openspec/, and kept while it is the board's", () => {
		const view = boardOf([]);
		expect(presetsFor(view)).toEqual(["agentic-kanban", "solo"]);
		expect(
			presetsFor({ ...view, openspec: { present: true, cli: null, checking: false } }),
		).toEqual(["agentic-kanban", "solo", "spec-driven"]);
		expect(
			presetsFor({ ...view, settings: { ...view.settings, preset: "spec-driven" } }),
		).toContain("spec-driven");
	});
});

describe("a change's card", () => {
	test("offers Apply with tasks written and no attempt running, never Start", () => {
		expect(canStart(changeCard())).toBe(false);
		expect(canApply(changeCard({ stage: "ready", tasks: { completed: 0, total: 7 } }))).toBe(true);
		expect(canApply(changeCard({ stage: "planning", tasks: { completed: 0, total: 0 } }))).toBe(
			false,
		);
		expect(canApply(changeCard({ stage: "archived", archived: true }))).toBe(false);
		expect(canApply(changeCard({}, { live: [liveOf()] }))).toBe(false);
		expect(canArchive(changeCard())).toBe(false);
		expect(canArchive(storedCard({}, { live: [liveOf()] }))).toBe(true);
		expect(shownId(changeCard())).toBe("add-2fa-login");
		expect(shownId(storedCard())).toBe("PA-1");
	});

	test("deltas read +n ~n −n →n with zero counts left out", () => {
		expect(deltaText({ added: 2, modified: 1, removed: 0, renamed: 0 })).toBe("+2 ~1");
		expect(deltaText({ added: 0, modified: 0, removed: 1, renamed: 2 })).toBe("−1 →2");
	});

	test("renders the chain, tasks and deltas in progress; the next artifact while planning", () => {
		const progress = tile(changeCard());
		expect(progress).toContain('data-testid="board-openspec" data-stage="in-progress"');
		expect(progress).toContain("3/7 tasks");
		expect(progress).toContain('data-capability="auth"');
		expect(progress).toContain("+2 ~1");
		expect(progress.match(/data-testid="board-openspec-artifact"/g)).toHaveLength(4);
		expect(progress).toContain('data-source="openspec"');
		expect(progress).toContain("add-2fa-login");
		expect(progress).toContain("board-card-apply");
		expect(progress).not.toContain("board-card-start");
		const applying = tile(storedCard({}, { live: [liveOf()] }));
		expect(applying).not.toContain("board-card-apply");
		expect(applying).toContain('data-badge="working"');

		const planning = tile(
			changeCard({
				stage: "planning",
				tasks: { completed: 0, total: 0 },
				artifacts: artifacts(["done", "ready", "ready", "blocked"]),
				nextArtifact: "specs",
			}),
		);
		expect(planning).toContain("Next: Spec deltas");
		expect(planning).toContain('data-status="blocked"');
		expect(planning).not.toContain("board-openspec-tasks");

		const ready = tile(changeCard({ stage: "ready", tasks: { completed: 0, total: 7 } }));
		expect(ready).toContain("board-card-apply");

		const invalid = tile(changeCard({ validation: { valid: false, errors: 1, warnings: 2 } }));
		expect(invalid).toContain('data-valid="false"');
		expect(invalid).toContain("Invalid: 3 issues");

		const unknown = tile(
			changeCard({ artifacts: [], error: "Schema 'x' not found.", schema: "x" }),
		);
		expect(unknown).toContain("Unknown schema x");
		expect(unknown).not.toContain("board-openspec-chain");
	});
});

describe("the change in Peek", () => {
	const section = (card: Card, cli: string | null) =>
		html(
			<OpenspecSection
				host={fakeHost().host}
				projectId="p1"
				card={card}
				status={{ present: true, cli, checking: false }}
				onChanged={noop}
			/>,
		);

	test("shows a tab per artifact and, without the CLI, disables Validate beside the install hint", () => {
		const offline = section(
			changeCard({ stage: "ready", tasks: { completed: 0, total: 7 } }),
			null,
		);
		for (const id of ["proposal", "specs", "design", "tasks"])
			expect(offline).toContain(`data-testid="board-openspec-tab-${id}"`);
		expect(offline).toContain("npm install -g @fission-ai/openspec");
		expect(offline).toMatch(/<button[^>]*disabled=""[^>]*data-testid="board-openspec-validate"/);
		expect(offline).toContain("board-openspec-apply");

		const online = section(changeCard(), "2.1.0");
		expect(online).not.toContain("board-openspec-install");
		expect(online).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="board-openspec-validate"/);
		expect(online).toContain('data-path="openspec/changes/add-2fa-login/proposal.md"');
	});

	test("the actions send their queries, and an artifact opens in this workspace's Peek or its own", async () => {
		const fake = fakeHost((method) =>
			method === "openspec.propose" ? { workspaceId: "w0", sessionId: "s9" } : {},
		);
		await validateChange(fake.host, "PA-1", "p1");
		await archiveChange(fake.host, "PA-1", "p1");
		const opened: unknown[] = [];
		await proposeChange(
			{ ...fake.host, openChat: (target) => opened.push(target) },
			"p1",
			"Passkeys",
		);
		expect(fake.queries).toEqual([
			{ method: "openspec.validate", params: { cardId: "PA-1", projectId: "p1" } },
			{ method: "openspec.archive", params: { cardId: "PA-1", projectId: "p1" } },
			{ method: "openspec.propose", params: { projectId: "p1", description: "Passkeys" } },
		]);
		expect(opened).toEqual([{ projectId: "p1", workspaceId: "w0", sessionId: "s9" }]);
		expect(openChangeFile(fake.host, overlay(), "openspec/changes/add-2fa-login/tasks.md")).toBe(
			"peek",
		);
		expect(fake.peeks).toEqual([{ kind: "file", path: "openspec/changes/add-2fa-login/tasks.md" }]);
		expect(
			openChangeFile(fake.host, overlay({ workspaceId: "w1" }), "openspec/changes/x/tasks.md"),
		).toBe("file");
		expect(fake.files).toEqual([{ workspaceId: "w1", path: "openspec/changes/x/tasks.md" }]);
	});
});
