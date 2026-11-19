import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { AskUserQuestionArgs } from "@thinkrail/pi-ask-user-question/core";
import {
	closeSettings,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
	worktreeRows,
} from "./fixtures/app";
import { git } from "./fixtures/git";
import { ghCalls, writeGhScenario } from "./fixtures/github";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

const BOARD_RAIL = "tool-rail-ext:board:board";

function boardTool(page: Page): Locator {
	return page.getByTestId("board-tool");
}

function column(page: Page, id: string): Locator {
	return boardTool(page).locator(`[data-testid="board-column"][data-column="${id}"]`);
}

function card(page: Page, title: string): Locator {
	return boardTool(page).getByTestId("board-card").filter({ hasText: title });
}

function peekCard(page: Page): Locator {
	return page.getByTestId("peek-pane").getByTestId("board-card-panel");
}

/** The kickoff texts the host announces on `workspace.creationChanged`, captured with no model involved. */
function observeKickoffs(page: Page): () => string[] {
	const texts: string[] = [];
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const frame = JSON.parse(payload.toString()) as {
				channel?: string;
				data?: { kickoff?: { text?: string } };
			};
			const text = frame.data?.kickoff?.text;
			if (frame.channel === "workspace.creationChanged" && text && !texts.includes(text))
				texts.push(text);
		});
	});
	return () => [...texts];
}

async function openBoard(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const rail = page.getByTestId(BOARD_RAIL);
	await expect(rail).toBeVisible();
	await expect(rail).toHaveAttribute("aria-pressed", "false");
	await rail.click();
	await expect(rail).toHaveAttribute("aria-pressed", "true");
	await expect(boardTool(page)).toBeVisible();
}

async function createCard(page: Page, title: string): Promise<void> {
	await boardTool(page).getByTestId("board-new").click();
	const field = boardTool(page).getByTestId("board-new-card-title");
	await field.fill(title);
	await field.press("Enter");
	await expect(card(page, title)).toBeVisible();
}

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
	const from = await source.boundingBox();
	const to = await target.boundingBox();
	if (!from || !to) throw new Error("the drag has no geometry");
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 8, { steps: 4 });
	await page.mouse.move(to.x + to.width / 2, to.y + 24, { steps: 8 });
	await expect(target).toHaveAttribute("data-over", "true");
	await page.mouse.up();
}

async function setBoardExtension(page: Page, enabled: boolean): Promise<void> {
	await openSettingsSection(page, "extensions");
	const toggle = page.getByTestId("extension-toggle-board");
	if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await closeSettings(page);
}

test.afterEach(async ({ page }) => {
	if (!page.isClosed()) await setBoardExtension(page, true);
});

const BASE_TS = 1_704_000_000_000;
const SECOND_REPO = join(E2E_DATA_DIR, "board-second-project");

interface SeedCard {
	id: string;
	title: string;
	category: string;
	column: string;
	rank: number;
	attempt?: { workspaceId: string; sessionId: string };
	origin?: { sessionId: string; cardId?: string };
	createdBy?: "agent";
	size?: "S" | "M" | "L";
}

/** The open projects' ids and Default workspaces, read from the host. */
async function openProjects(
	page: Page,
): Promise<{ id: string; name: string; defaultId: string }[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const projects = await wire.request("project.list", {});
		const rows: { id: string; name: string; defaultId: string }[] = [];
		for (const project of projects) {
			const workspaces = await wire.request("workspace.list", { projectId: project.id });
			const fallback = workspaces.find((workspace) => workspace.kind === "default");
			if (fallback) rows.push({ id: project.id, name: project.name, defaultId: fallback.id });
		}
		return rows;
	} finally {
		wire.close();
	}
}

/** Writes a project's board file as a host restart would find it (the board reads it once switched on). */
function seedBoard(projectId: string, prefix: string, cards: SeedCard[]): void {
	const dir = join(E2E_DATA_DIR, "extensions", "board", projectId);
	mkdirSync(dir, { recursive: true });
	const stored = cards.map(({ attempt, ...card }) => ({
		...card,
		...(card.size ? { sizeSuggested: card.createdBy === "agent" } : {}),
		createdBy: card.createdBy ?? "human",
		createdAt: BASE_TS,
		updatedAt: BASE_TS,
		attempts: attempt ? [{ ...attempt, workflow: "implement", startedAt: BASE_TS, notes: [] }] : [],
	}));
	writeFileSync(
		join(dir, "cards.json"),
		JSON.stringify({ version: 1, prefix, nextNumber: cards.length + 1, cards: stored }),
	);
}

/** A fresh board over the seeded files: switching the extension off and on rebuilds it. */
async function reloadBoards(page: Page): Promise<void> {
	await setBoardExtension(page, false);
	await setBoardExtension(page, true);
}

function seedQuestion(worktree: string, id: string): void {
	const args = {
		questions: [
			{
				question: "Which rollout?",
				header: "Rollout",
				options: [
					{ label: "Canary", description: "Start small" },
					{ label: "All", description: "Ship everywhere" },
				],
			},
		],
	} satisfies AskUserQuestionArgs;
	seedWorkspaceSession(worktree, {
		id,
		name: "Pick the rollout",
		messages: [
			{ role: "user", text: "Ask for rollout input.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: `${id}-question`, name: "ask_user_question", arguments: args },
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1,
			},
		],
	});
}

function seedFailure(worktree: string, id: string): void {
	seedWorkspaceSession(worktree, {
		id,
		name: "Shard the suite",
		messages: [
			{ role: "user", text: "Shard the e2e suite.", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "",
				stopReason: "error",
				errorMessage: "provider overloaded",
				timestamp: BASE_TS + 1,
			},
		],
	});
}

async function openSecondProject(page: Page): Promise<string> {
	rmSync(SECOND_REPO, { recursive: true, force: true });
	mkdirSync(SECOND_REPO, { recursive: true });
	git(SECOND_REPO, "init", "-b", "main");
	git(SECOND_REPO, "config", "user.email", "e2e@thinkrail.test");
	git(SECOND_REPO, "config", "user.name", "ThinkRail E2E");
	git(SECOND_REPO, "config", "commit.gpgsign", "false");
	writeFileSync(join(SECOND_REPO, "README.md"), "# payments\n");
	git(SECOND_REPO, "add", "-A");
	git(SECOND_REPO, "commit", "-m", "seed");
	writeFileSync(E2E_PICK_DIR_POINTER, SECOND_REPO);
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item")).toHaveCount(2);
	return realpathSync(SECOND_REPO);
}

/** The window's persisted frame and views, ids included, with what each visible side pane shows. */
async function layoutSnapshot(page: Page): Promise<unknown> {
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
	return page.evaluate(() => {
		const key = Object.keys(localStorage).find((name) => name.startsWith("thinkrail:workbench:"));
		const stored = key ? JSON.parse(localStorage.getItem(key) ?? "{}") : {};
		const panes = [...document.querySelectorAll<HTMLElement>("[data-side][data-group-id]")].map(
			(pane) => [
				pane.dataset.side,
				pane.dataset.groupId,
				pane.dataset.tools,
				pane.querySelector<HTMLElement>("[data-tool-body]")?.dataset.toolBody ?? null,
			],
		);
		return { frame: stored.frame, views: stored.viewsByWorkspace, panes };
	});
}

async function runPaletteCommand(page: Page, id: string, query: string): Promise<void> {
	await pressPlatformShortcut(page, "k");
	const palette = page.getByTestId("search-palette");
	await expect(palette).toBeVisible();
	await page.getByTestId("search-input").fill(query);
	const row = palette.locator(`[data-testid="search-row"][data-item-id="command:${id}"]`);
	await expect(row).toBeVisible();
	await row.click();
	await expect(palette).toBeHidden();
}

test("the Board tool creates a card, edits it in Peek and starts it into a new workspace whose chat takes the kickoff", async ({
	page,
}) => {
	const kickoffs = observeKickoffs(page);
	await openBoard(page);
	await expect(boardTool(page).getByTestId("board-empty")).toContainText("No cards yet");
	await expect(boardTool(page).getByTestId("board-project")).not.toBeEmpty();

	await createCard(page, "Draft the board");
	await expect(column(page, "backlog").getByTestId("board-card")).toHaveCount(1);
	await expect(peekCard(page)).toBeVisible();
	const title = peekCard(page).getByTestId("board-card-title");
	await expect(title).toHaveValue("Draft the board");
	await title.fill("Ship the board");
	await title.press("Enter");
	await expect(card(page, "Ship the board")).toBeVisible();
	await peekCard(page).getByTestId("board-card-acceptance-add").fill("Cards launch a workspace");
	await peekCard(page).getByTestId("board-card-acceptance-add").press("Enter");
	await expect(peekCard(page).getByTestId("board-card-acceptance-item")).toHaveText([
		"Cards launch a workspace",
	]);
	await expect(peekCard(page).getByTestId("board-start-workflow")).toHaveValue("implement");
	await peekCard(page).getByTestId("board-card-size").selectOption("M");
	await expect(peekCard(page).getByTestId("board-start-workflow")).toHaveValue("brainstorm");

	await peekCard(page).getByTestId("board-start-workflow").selectOption("implement");
	await peekCard(page).getByTestId("board-start-submit").click();
	await expect(peekCard(page).getByTestId("board-attempt")).toHaveCount(1, { timeout: 30_000 });
	await expect(worktreeRows(page)).toHaveCount(1);
	await expect(column(page, "building").getByTestId("board-card")).toContainText("Ship the board");
	await expect(peekCard(page).getByTestId("board-activity-item").first()).toContainText(
		"automatically",
	);

	await expect
		.poll(kickoffs)
		.toContainEqual(expect.stringMatching(/^Card \w+-1: Ship the board\n/));
	expect(kickoffs().find((text) => text.includes("Ship the board"))).toContain(
		"Acceptance criteria:\n- Cards launch a workspace",
	);

	await peekCard(page).getByTestId("board-attempt-chat").click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(boardTool(page)).toBeVisible();
	await expect(card(page, "Ship the board")).toBeVisible();
});

test("follow selection: off, a click only peeks a running card; on, it enters the card's workspace with the card in Peek there", async ({
	page,
}) => {
	await openBoard(page);
	await createCard(page, "Follow me");
	await page.getByTestId("peek-close").click();
	await card(page, "Follow me").getByTestId("board-card-start").click();
	await expect(column(page, "building").getByTestId("board-card")).toContainText("Follow me", {
		timeout: 30_000,
	});
	await expect(worktreeRows(page)).toHaveCount(1);

	await card(page, "Follow me").getByTestId("board-card-open").click();
	await expect(peekCard(page).getByTestId("board-card-title")).toHaveValue("Follow me");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await page.getByTestId("peek-close").click();

	await boardTool(page).getByTestId("board-settings").click();
	const follow = page.getByTestId("board-follow-selection");
	await expect(follow).toHaveAttribute("aria-checked", "false");
	await follow.click();
	await expect(follow).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");
	await expect(follow).toBeHidden();

	await card(page, "Follow me").getByTestId("board-card-open").click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(peekCard(page).getByTestId("board-card-title")).toHaveValue("Follow me");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(boardTool(page)).toBeVisible();

	await boardTool(page).getByTestId("board-settings").click();
	await expect(page.getByTestId("board-follow-selection")).toHaveAttribute("aria-checked", "true");
});

test("dragging and Alt+arrows move a card with a logged override, and the preset switch remaps the columns", async ({
	page,
}) => {
	await openBoard(page);
	await createCard(page, "Drag me");
	await createCard(page, "Keys move me");

	await dragTo(page, card(page, "Drag me").getByTestId("board-card-open"), column(page, "ready"));
	await expect(column(page, "ready").getByTestId("board-card")).toContainText("Drag me");
	await card(page, "Drag me").getByTestId("board-card-open").click();
	await expect(peekCard(page).getByTestId("board-card-column")).toHaveText("Ready");
	const moved = peekCard(page).getByTestId("board-activity-item").first();
	await expect(moved).toContainText("Backlog → Ready");
	await expect(moved).toHaveAttribute("data-actor", "human");

	const keyed = card(page, "Keys move me").getByTestId("board-card-open");
	await keyed.focus();
	await page.keyboard.press("Alt+ArrowRight");
	await expect(column(page, "ready").getByTestId("board-card")).toHaveCount(2);
	await expect(card(page, "Keys move me").getByTestId("board-card-open")).toBeFocused();

	await boardTool(page).getByTestId("board-view-list").click();
	await expect(boardTool(page).getByTestId("board-list-row")).toHaveCount(2);
	await boardTool(page).getByTestId("board-view-board").click();

	await boardTool(page).getByTestId("board-preset").click();
	await page.getByTestId("board-preset-solo").click();
	await expect(boardTool(page).getByTestId("board-preset")).toHaveAttribute("data-preset", "solo");
	await expect(column(page, "todo").getByTestId("board-card")).toHaveCount(2);
	await expect(column(page, "ready")).toHaveCount(0);
});

test("switching the extension off shows the Board tool's disabled placeholder in place and keeps the layout", async ({
	page,
}) => {
	await openBoard(page);
	await createCard(page, "Survives the switch");
	const pane = page.locator('[data-tool-body="ext:board:board"]');
	await expect(pane).toBeVisible();

	await setBoardExtension(page, false);
	await expect(pane.getByTestId("extension-panel-disabled")).toBeVisible();
	await expect(page.getByTestId(BOARD_RAIL)).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("tool-rail-projects")).toBeVisible();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(
		page.locator('[data-tool-body="ext:board:board"]').getByTestId("extension-panel-disabled"),
	).toBeVisible();

	await setBoardExtension(page, true);
	await expect(card(page, "Survives the switch")).toBeVisible();
});

test("screenshots: the board narrow in a side pane, wide with cards in several columns, and a card in Peek", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1000 });
	await openBoard(page);
	const titles = [
		"Sticky breadcrumb segments overlap",
		"CSV export from the Artifacts tool",
		"Terminal loses focus after split",
		"Intel Mac desktop downloads",
		"Strip ANSI from extension names",
		"Board: cycle burnup chart",
	] as const;
	for (const title of titles) await createCard(page, title);
	await page.getByTestId("peek-close").click();
	for (const [title, target] of [
		[titles[3], "review"],
		[titles[4], "done"],
		[titles[2], "ready"],
		[titles[5], "designing"],
	] as const) {
		const tile = card(page, title);
		while ((await tile.getAttribute("data-column")) !== target) {
			const from = await tile.getAttribute("data-column");
			await tile.getByTestId("board-card-open").focus();
			await page.keyboard.press("Alt+ArrowRight");
			await expect(tile).not.toHaveAttribute("data-column", from ?? "");
		}
	}
	await card(page, titles[0]).getByTestId("board-card-start").click();
	await expect(column(page, "building").getByTestId("board-card")).toHaveCount(1, {
		timeout: 30_000,
	});
	for (const toast of await page.getByTestId("toast").all())
		await toast.getByRole("button").last().click();
	await expect(boardTool(page)).toHaveAttribute("data-layout", "stacked");
	await shot(page, "board", "narrow-side-pane");

	await pressPlatformShortcut(page, "J");
	await expect(page.getByTestId("right-stack")).toHaveCount(0);
	await page.getByTestId("tool-rail-projects").click();
	const handle = page.getByTestId("resize-left");
	const box = await handle.boundingBox();
	if (!box) throw new Error("the left side has no separator");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(1500, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
	await expect(boardTool(page)).toHaveAttribute("data-layout", "columns");
	await shot(page, "board", "board-wide");

	await card(page, titles[1]).getByTestId("board-card-open").click();
	await expect(peekCard(page)).toBeVisible();
	await shot(page, "board", "card-in-peek");
});

test("the Needs-you inbox lists waiting and failed cards of every open project, above the board and as a topbar counter", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	const sample = realpathSync(E2E_FIXTURE_REPO);
	seedQuestion(sample, "board-e2e-question");
	seedFailure(sample, "board-e2e-failed");
	const second = await openSecondProject(page);
	seedQuestion(second, "board-e2e-second-question");
	const projects = await openProjects(page);
	const first = projects.find((project) => project.name === "sample-project");
	const other = projects.find((project) => project.name !== "sample-project");
	if (!first || !other) throw new Error("missing the two projects");
	seedBoard(first.id, "SP", [
		{
			id: "SP-1",
			title: "Pick the rollout",
			category: "started",
			column: "building",
			rank: 1,
			attempt: { workspaceId: first.defaultId, sessionId: "board-e2e-question" },
		},
		{
			id: "SP-2",
			title: "Shard the e2e suite",
			category: "started",
			column: "building",
			rank: 2,
			attempt: { workspaceId: first.defaultId, sessionId: "board-e2e-failed" },
		},
	]);
	seedBoard(other.id, "BS", [
		{
			id: "BS-1",
			title: "Which font license to ship",
			category: "started",
			column: "building",
			rank: 1,
			attempt: { workspaceId: other.defaultId, sessionId: "board-e2e-second-question" },
		},
	]);
	await reloadBoards(page);

	const counter = page.getByTestId("topbar-actions").getByTestId("board-inbox-status");
	await expect(counter).toHaveText("Needs you · 3");
	await counter.click();
	const popover = page.getByTestId("board-inbox-popover");
	const rows = popover.getByTestId("board-inbox-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: "SP-2" })).toHaveAttribute("data-reason", "failed");
	await expect(rows.filter({ hasText: "SP-2" }).getByTestId("board-inbox-answer")).toHaveText(
		"Retry",
	);
	await expect(rows.filter({ hasText: "BS-1" })).toContainText(other.name);
	await expect(rows.filter({ hasText: "BS-1" })).toContainText("Question pending");
	await shot(page, "board", "inbox-topbar-popover");
	await rows.filter({ hasText: "SP-1" }).getByTestId("board-inbox-answer").click();
	await expect(popover).toBeHidden();
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toContainText([
		"Pick the rollout",
	]);

	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		await wire.request("project.close", { id: other.id });
		await expect(counter).toHaveText("Needs you · 2");
		await wire.request("project.open", { path: second });
		await expect(counter).toHaveText("Needs you · 3");
	} finally {
		wire.close();
	}

	await page.getByTestId(BOARD_RAIL).click();
	await expect(boardTool(page)).toBeVisible();
	const strip = boardTool(page).getByTestId("board-inbox-strip");
	await expect(strip.getByTestId("board-inbox-row")).toHaveCount(3);
	await expect(strip).toHaveAttribute("data-compact", "true");
	await expect(card(page, "Pick the rollout").getByTestId("board-agent-badge")).toHaveAttribute(
		"data-badge",
		"waiting",
	);
	await expect(card(page, "Shard the e2e suite").getByTestId("board-agent-badge")).toHaveAttribute(
		"data-badge",
		"failed",
	);
	await shot(page, "board", "inbox-strip");
	await boardTool(page).getByTestId("board-mode-toggle").click();
	await expect(strip).not.toHaveAttribute("data-compact", "true");
	await shot(page, "board", "board-mode-inbox");
	await boardTool(page).getByTestId("board-mode-toggle").click();
	await expect(strip).toHaveAttribute("data-compact", "true");

	await strip
		.getByTestId("board-inbox-row")
		.filter({ hasText: "BS-1" })
		.getByTestId("board-inbox-answer")
		.click();
	await expect(page.getByTestId("scope-project-name")).toHaveText(other.name);
	await expect(card(page, "Which font license to ship")).toBeVisible();
});

test("Board mode widens the Board tool on the left and leaving it restores the exact previous layout", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openBoard(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await createCard(page, "Card in Board mode");
	await page.getByTestId("peek-close").click();
	const before = await layoutSnapshot(page);

	await boardTool(page).getByTestId("board-mode-toggle").click();
	await expect(boardTool(page).getByTestId("board-mode-toggle")).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(boardTool(page).getByTestId("board-mode-toggle")).toHaveText("Exit Board mode");
	await expect(page.locator('[data-side="right"][data-group-id]')).toHaveCount(0);
	await expect(page.locator('[data-side="left"][data-group-id]')).toHaveCount(1);
	await expect(page.getByTestId("tool-rail-projects")).toBeVisible();
	const workbench = await page.getByTestId("workbench").boundingBox();
	const board = await boardTool(page).boundingBox();
	if (!workbench || !board) throw new Error("the board has no geometry");
	expect(board.width).toBeGreaterThan(workbench.width * 0.5);
	await expect(boardTool(page)).toHaveAttribute("data-layout", "columns");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await shot(page, "board", "board-mode");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(boardTool(page).getByTestId("board-mode-toggle")).toHaveAttribute(
		"data-active",
		"true",
	);

	await runPaletteCommand(page, "view.layoutMode.exit", "Exit Board mode");
	await expect(boardTool(page).getByTestId("board-mode-toggle")).not.toHaveAttribute(
		"data-active",
		"true",
	);
	expect(await layoutSnapshot(page)).toEqual(before);

	await runPaletteCommand(page, "view.layoutMode.enter.board:board", "Enter Board mode");
	await expect(page.locator('[data-side="right"][data-group-id]')).toHaveCount(0);
	await boardTool(page).getByTestId("board-mode-toggle").click();
	expect(await layoutSnapshot(page)).toEqual(before);
});

test("the palette shows the Board tool like a built-in tool", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(boardTool(page)).toHaveCount(0);
	await runPaletteCommand(page, "view.show.ext:board:board", "Show Board");
	await expect(boardTool(page)).toBeVisible();
	await expect(page.getByTestId(BOARD_RAIL)).toHaveAttribute("aria-pressed", "true");
});

test("column headers carry the Review WIP limit, marked once over it, and Start past it asks first", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	seedBoard(project.id, "SP", [
		{ id: "SP-1", title: "First in review", category: "review", column: "review", rank: 1 },
		{ id: "SP-2", title: "Second in review", category: "review", column: "review", rank: 2 },
		{ id: "SP-3", title: "Ready to start", category: "backlog", column: "backlog", rank: 3 },
	]);
	await reloadBoards(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId(BOARD_RAIL).click();
	await boardTool(page).getByTestId("board-mode-toggle").click();
	await expect(boardTool(page)).toHaveAttribute("data-layout", "columns");
	const review = column(page, "review");
	await expect(review.getByTestId("board-column-count")).toHaveText("2");
	await expect(review.getByTestId("board-column-wip")).toHaveText("2/5");
	await expect(review.getByTestId("board-column-wip")).not.toHaveAttribute("data-over", "true");

	await boardTool(page).getByTestId("board-settings").click();
	await page.getByTestId("board-wip-limit-review").fill("1");
	await page.getByTestId("board-wip-save").click();
	await expect(review.getByTestId("board-column-wip")).toHaveText("2/1");
	await expect(review.getByTestId("board-column-wip")).toHaveAttribute("data-over", "true");
	await expect(boardTool(page).getByTestId("board-wip-review")).toHaveAttribute(
		"data-over",
		"true",
	);

	await card(page, "Ready to start").getByTestId("board-card-start").click();
	const warning = card(page, "Ready to start").getByTestId("board-start-warning");
	await expect(warning).toContainText("Review is over its limit (2/1)");
	await expect(worktreeRows(page)).toHaveCount(0);
	await warning.getByRole("button", { name: "Not now" }).click();
	await expect(warning).toHaveCount(0);
	await expect(card(page, "Ready to start").getByTestId("board-card-start")).toBeVisible();

	await card(page, "Ready to start").getByTestId("board-card-open").click();
	await peekCard(page).getByTestId("board-start-submit").click();
	const peekWarning = peekCard(page).getByTestId("board-start-warning");
	await expect(peekWarning).toContainText("Review is over its limit (2/1)");
	await expect(peekCard(page).getByTestId("board-start-submit")).toHaveCount(0);
	await expect(worktreeRows(page)).toHaveCount(0);
	await peekWarning.getByRole("button", { name: "Not now" }).click();
	await expect(peekWarning).toHaveCount(0);
	await expect(peekCard(page).getByTestId("board-start-submit")).toBeVisible();
});

test("Triage groups an agent's decomposition, and Accept all moves it into Backlog as a whole", async ({
	page,
}) => {
	await openFixtureProject(page);
	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	const origin = { sessionId: "board-e2e-decomposer", cardId: "SP-1" };
	seedBoard(project.id, "SP", [
		{ id: "SP-1", title: "Epic: payments", category: "started", column: "building", rank: 1 },
		{
			id: "SP-2",
			title: "Invoice PDF",
			category: "triage",
			column: "triage",
			rank: 2,
			origin,
			createdBy: "agent",
			size: "M",
		},
		{
			id: "SP-3",
			title: "Refund flow",
			category: "triage",
			column: "triage",
			rank: 3,
			origin,
			createdBy: "agent",
			size: "S",
		},
		{
			id: "SP-4",
			title: "Stray follow-up",
			category: "triage",
			column: "triage",
			rank: 4,
			createdBy: "agent",
		},
	]);
	await reloadBoards(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId(BOARD_RAIL).click();
	const triage = boardTool(page).getByTestId("board-triage");
	await expect(triage.getByTestId("board-triage-toggle")).toHaveText("Triage · 3");
	await expect(triage.getByTestId("board-triage-group")).toHaveCount(0);
	await triage.getByTestId("board-triage-toggle").click();
	const decomposition = triage.locator(
		'[data-testid="board-triage-group"][data-origin="board-e2e-decomposer"]',
	);
	await expect(decomposition).toContainText("Filed from SP-1's chat");
	await expect(decomposition.getByTestId("board-triage-card")).toHaveCount(2);
	await expect(decomposition.getByTestId("board-size").first()).toHaveText("M?");
	await decomposition.getByTestId("board-triage-accept-all").click();
	await expect(column(page, "backlog").getByTestId("board-card")).toHaveCount(2);
	await expect(column(page, "backlog")).toContainText("Invoice PDF");
	await expect(column(page, "backlog")).toContainText("Refund flow");
	await expect(triage.getByTestId("board-triage-toggle")).toHaveText("Triage · 1");
	await expect(triage.getByTestId("board-triage-card")).toHaveCount(1);
});

const TASK_SPEC = [
	"---",
	"id: task-board-sources",
	"type: task-spec",
	"status: draft",
	"title: Board sources",
	"---",
	"",
	"## Request",
	"",
	"Show task-specs and GitHub issues on the board.",
	"",
	"## Deferrals",
	"",
	"- OpenSpec source",
	"- Linear source",
	"",
].join("\n");

test("an unbound workspace's task-spec shows as a card, Adopt binds it once, and its deferrals go to Triage", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	let worktree: string;
	try {
		const workspace = await wire.request(
			"workspace.create",
			{ projectId: project.id, name: "sources" },
			30_000,
		);
		worktree = workspace.worktreePath;
	} finally {
		wire.close();
	}
	mkdirSync(join(worktree, ".thinkrail", "context"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "context", "TASK-x.md"), TASK_SPEC);

	await enterDefaultWorkspace(page);
	await page.getByTestId(BOARD_RAIL).click();
	await boardTool(page).getByTestId("board-mode-toggle").click();
	const unbound = card(page, "Board sources");
	await expect(unbound).toHaveAttribute("data-source", "task-spec");
	await expect(unbound).toHaveAttribute("data-virtual", "true");
	await expect(unbound).toHaveAttribute("data-column", "building");
	await expect(unbound.getByTestId("board-task-spec-status")).toHaveText("draft");
	await expect(unbound.getByTestId("board-card-start")).toHaveCount(0);
	await shot(page, "board", "task-spec-card");

	await unbound.getByTestId("board-card-adopt").click();
	await expect(card(page, "Board sources")).toHaveCount(1);
	const adopted = card(page, "Board sources");
	await expect(adopted).toHaveAttribute("data-card-id", "SP-1");
	await expect(adopted).not.toHaveAttribute("data-virtual", "true");
	await expect(adopted).toHaveAttribute("data-column", "building");
	await expect(adopted.getByTestId("board-task-spec")).toContainText("Board sources");

	await adopted.getByTestId("board-card-open").click();
	const spec = peekCard(page).getByTestId("board-card-task-spec");
	await expect(spec).toHaveCount(1);
	await expect(spec.getByTestId("board-task-spec-open")).toHaveAttribute(
		"data-target",
		"workspace",
	);
	await spec.getByTestId("board-task-spec-deferrals").click();
	await expect(peekCard(page).getByTestId("board-task-spec-outcome")).toHaveText(
		"Filed 2 deferrals into Triage.",
	);
	const triage = boardTool(page).getByTestId("board-triage");
	await expect(triage.getByTestId("board-triage-toggle")).toHaveText("Triage · 2");
	await triage.getByTestId("board-triage-toggle").click();
	await expect(triage.getByTestId("board-triage-group")).toContainText("Deferred from SP-1");
	await spec.getByTestId("board-task-spec-deferrals").click();
	await expect(peekCard(page).getByTestId("board-task-spec-outcome")).toHaveText(
		"No new deferrals; 2 are already on the board.",
	);
	await expect(triage.getByTestId("board-triage-card")).toHaveCount(2);
});

test("Show GitHub issues lists the user's open issues through gh as Backlog cards, and an edit keeps one on the board", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openBoard(page);
	await boardTool(page).getByTestId("board-mode-toggle").click();
	await boardTool(page).getByTestId("board-github-menu").click();
	await page.getByTestId("board-github-toggle").click();
	const banner = boardTool(page).getByTestId("board-github-error");
	await expect(banner).toContainText("gh auth login");
	await expect(boardTool(page).getByTestId("board-empty")).toBeVisible();

	writeGhScenario({
		prs: [],
		issues: [
			{
				number: 12,
				title: "Crash on an empty board",
				body: "Open the board with no cards.",
				labels: [{ name: "bug" }],
			},
			{ number: 13, title: "Export the cards" },
			{ number: 14, title: "Already closed", state: "CLOSED" },
		],
	});
	await banner.getByTestId("board-github-retry").click();
	await expect(banner).toHaveCount(0);
	const issue = card(page, "Crash on an empty board");
	await expect(issue).toHaveAttribute("data-source", "github");
	await expect(issue).toHaveAttribute("data-card-id", "#12");
	await expect(issue).toHaveAttribute("data-column", "backlog");
	await expect(card(page, "Export the cards")).toBeVisible();
	await expect(card(page, "Already closed")).toHaveCount(0);
	expect(ghCalls()).toContainEqual([
		"issue",
		"list",
		"--state",
		"open",
		"--limit",
		"100",
		"--json",
		"number,title,body,labels,url,assignees,updatedAt",
	]);
	await shot(page, "board", "github-issues");

	await issue.getByTestId("board-card-open").click();
	await expect(peekCard(page).getByTestId("board-card-issue")).toHaveText("Issue #12 on GitHub");
	await peekCard(page).getByTestId("board-card-acceptance-add").fill("No crash");
	await peekCard(page).getByTestId("board-card-acceptance-add").press("Enter");
	await expect(card(page, "Crash on an empty board")).toHaveAttribute("data-card-id", "SP-1");
	await expect(card(page, "Crash on an empty board")).not.toHaveAttribute("data-virtual", "true");
	await expect(card(page, "Crash on an empty board")).toHaveCount(1);
	await expect(peekCard(page).getByTestId("board-card-acceptance-item")).toHaveText(["No crash"]);
	expect(ghCalls().every((argv) => argv[0] === "issue" && argv[1] === "list")).toBe(true);

	await boardTool(page).getByTestId("board-github-menu").click();
	await page.getByTestId("board-github-toggle").click();
	await expect(card(page, "Export the cards")).toHaveCount(0);
	await expect(card(page, "Crash on an empty board")).toHaveAttribute("data-card-id", "SP-1");
});

/** The kickoffs of the roadmap chats the board started, read from its `roadmap.chat` replies (no model needed). */
function observeRoadmapChats(page: Page): () => string[] {
	const texts: string[] = [];
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			const frame = JSON.parse(payload.toString()) as {
				ok?: boolean;
				result?: { kickoff?: unknown; sessionId?: unknown; workspaceId?: unknown };
			};
			const kickoff = frame.result?.kickoff;
			if (frame.ok && typeof kickoff === "string" && typeof frame.result?.sessionId === "string")
				texts.push(kickoff);
		});
	});
	return () => [...texts];
}

function horizon(page: Page, id: "now" | "next" | "later"): Locator {
	return boardTool(page).locator(`[data-testid="board-horizon"][data-horizon="${id}"]`);
}

function peekInitiative(page: Page): Locator {
	return page.getByTestId("peek-pane").getByTestId("board-initiative-panel");
}

async function newInitiative(page: Page, where: "now" | "next" | "later", title: string) {
	await horizon(page, where).getByTestId("board-initiative-new").click();
	const field = horizon(page, where).getByTestId("board-initiative-new-title");
	await field.fill(title);
	await field.press("Enter");
	await expect(horizon(page, where).getByTestId("board-initiative")).toContainText([title]);
	await expect(peekInitiative(page).getByTestId("board-initiative-title")).toHaveValue(title);
}

test("the roadmap: an initiative made in Next is dragged to Now, edited in Peek with a card, shown under its goal, and planned with the agent", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1720, height: 1000 });
	const kickoffs = observeRoadmapChats(page);
	await openBoard(page);
	await createCard(page, "Wire the roadmap views");
	const cardId = await card(page, "Wire the roadmap views").getAttribute("data-card-id");
	if (!cardId) throw new Error("the card has no id");
	await page.getByTestId("peek-close").click();
	await boardTool(page).getByTestId("board-mode-toggle").click();
	await expect(boardTool(page)).toHaveAttribute("data-layout", "columns");

	await boardTool(page).getByTestId("board-view-roadmap").click();
	await expect(boardTool(page).getByTestId("board-roadmap")).toHaveAttribute(
		"data-view",
		"horizons",
	);
	await expect(boardTool(page).getByTestId("board-horizon")).toHaveCount(3);
	await newInitiative(page, "later", "Planning surface");
	const goalId = await peekInitiative(page).getAttribute("data-initiative-id");
	await peekInitiative(page).getByTestId("board-initiative-specs-add").fill("capability-board");
	await peekInitiative(page).getByTestId("board-initiative-specs-add").press("Enter");
	await expect(peekInitiative(page).getByTestId("board-initiative-specs-item")).toHaveText([
		"capability-board",
	]);
	await newInitiative(page, "next", "Roadmap views");
	const id = await peekInitiative(page).getAttribute("data-initiative-id");
	if (!goalId || !id) throw new Error("the initiatives have no ids");

	const roadmapCard = horizon(page, "next")
		.getByTestId("board-initiative")
		.filter({ hasText: "Roadmap views" });
	await dragTo(page, roadmapCard.getByTestId("board-initiative-open"), horizon(page, "now"));
	await expect(horizon(page, "now").getByTestId("board-initiative")).toContainText([
		"Roadmap views",
	]);
	await expect(horizon(page, "next").getByTestId("board-initiative")).toHaveCount(0);

	await page.getByTestId("peek-close").click();
	await horizon(page, "now").getByTestId("board-initiative-open").click();
	await expect(peekInitiative(page)).toHaveAttribute("data-initiative-id", id);
	await expect(peekInitiative(page).getByTestId("board-roadmap-horizon").first()).toHaveAttribute(
		"data-horizon",
		"now",
	);
	const outcome = "Initiatives show their live progress, health and forecast";
	await peekInitiative(page).getByTestId("board-initiative-outcome").fill(outcome);
	await peekInitiative(page).getByTestId("board-initiative-outcome").press("Tab");
	await peekInitiative(page)
		.getByTestId("board-initiative-criteria-add")
		.fill("Now, Next and Later");
	await peekInitiative(page).getByTestId("board-initiative-criteria-add").press("Enter");
	await expect(peekInitiative(page).getByTestId("board-initiative-criteria-item")).toHaveText([
		"Now, Next and Later",
	]);
	await peekInitiative(page).getByTestId("board-initiative-target").fill("2026-12-31");
	await expect(peekInitiative(page).getByTestId("board-initiative-forecast")).toContainText("2026");
	await peekInitiative(page).getByTestId("board-initiative-add-card").selectOption(cardId);
	await expect(
		peekInitiative(page).locator(`[data-testid="board-initiative-card"][data-card-id="${cardId}"]`),
	).toContainText("Wire the roadmap views");
	const nowCard = horizon(page, "now").getByTestId("board-initiative");
	await expect(nowCard.getByTestId("board-roadmap-progress")).toHaveText("0/1 cards · 0 %");
	await expect(nowCard.getByTestId("board-roadmap-stack")).toBeVisible();
	await expect(nowCard.getByTestId("board-roadmap-health")).toHaveAttribute(
		"data-suggested",
		"true",
	);
	await expect(peekInitiative(page).getByTestId("board-initiative-forecast-value")).toHaveAttribute(
		"data-status",
		"insufficient",
	);
	await expect(peekInitiative(page).getByTestId("board-initiative-forecast")).toContainText(
		"Not enough data — needs ≥3 weeks of history",
	);
	await peekInitiative(page).getByTestId("board-initiative-parent").selectOption(goalId);
	await expect(nowCard.getByTestId("board-initiative-goal")).toHaveText("Planning surface");
	await peekInitiative(page).getByTestId("board-initiative-project-add").fill("Roadmap UI");
	await peekInitiative(page).getByTestId("board-initiative-project-add").press("Enter");
	const project = peekInitiative(page).getByTestId("board-initiative-project");
	await expect(project.getByTestId("board-initiative-project-title")).toHaveValue("Roadmap UI");
	await project.getByTestId("board-initiative-milestone-add").fill("Views usable");
	await project.getByTestId("board-initiative-milestone-add").press("Enter");
	await expect(project.getByTestId("board-initiative-milestone-title")).toHaveValue("Views usable");
	await project.getByTestId("board-initiative-project-assign").selectOption(cardId);
	await expect(project).toContainText("1 card");
	await expect(nowCard.getByTestId("board-roadmap-progress")).toHaveText("0/1 cards · 0 %");
	await peekInitiative(page).getByTestId("board-initiative-progress").click();
	await shot(page, "board", "roadmap-now-next-later");
	await page.setViewportSize({ width: 1720, height: 1700 });
	await shot(page.getByTestId("peek-pane"), "board", "initiative-in-peek");
	await page.setViewportSize({ width: 1720, height: 1000 });

	await boardTool(page).getByTestId("board-roadmap-view-goals").click();
	const goalGroup = boardTool(page).locator(
		`[data-testid="board-goal"][data-initiative-id="${goalId}"]`,
	);
	await expect(goalGroup.getByTestId("board-goal-initiative")).toHaveCount(1);
	await expect(goalGroup.getByTestId("board-goal-initiative")).toHaveAttribute(
		"data-initiative-id",
		id,
	);
	await expect(goalGroup.getByTestId("board-goal-initiative")).toContainText("Roadmap views");
	await expect(goalGroup.getByTestId("board-roadmap-horizon")).toHaveAttribute(
		"data-horizon",
		"now",
	);
	await expect(goalGroup.getByTestId("board-goal-spec")).toHaveText("capability-board");
	await shot(page, "board", "roadmap-goals");

	const chats = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const before = await chats.count();
	await peekInitiative(page).getByTestId("board-initiative-chat-plan").click();
	await expect.poll(kickoffs).toHaveLength(1);
	const [kickoff] = kickoffs();
	expect(kickoff?.startsWith(`/skill:roadmap-plan Plan initiative ${id} of the`)).toBe(true);
	expect(kickoff).toContain(`Initiative ${id}: Roadmap views\nOutcome: ${outcome}`);
	expect(kickoff).toContain("- Now, Next and Later");
	expect(kickoff).toContain("target 2026-12-31");
	await expect(chats).toHaveCount(before + 1);

	await boardTool(page).getByTestId("board-view-board").click();
	await expect(
		card(page, "Wire the roadmap views").getByTestId("board-card-initiative"),
	).toHaveText("Roadmap views");
	await boardTool(page).getByTestId("board-mode-toggle").click();
});
