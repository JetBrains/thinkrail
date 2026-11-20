import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { git, gitAs } from "./fixtures/git";
import { ghCalls, githubOrigin, readGhScenario, writeGhScenario } from "./fixtures/github";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

const BOARD_VIEW_RAIL = "view-rail-board:board";

function boardTool(page: Page): Locator {
	return page.getByTestId("board-main");
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

/** Enters Board view from the rail, unless the window is in it already. */
async function enterBoardView(page: Page): Promise<void> {
	const rail = page.getByTestId(BOARD_VIEW_RAIL);
	await expect(rail).toBeVisible();
	if ((await rail.getAttribute("aria-pressed")) !== "true") await rail.click();
	await expect(rail).toHaveAttribute("aria-pressed", "true");
	await expect(boardTool(page)).toBeVisible();
}

async function openBoard(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "false");
	await enterBoardView(page);
}

/** Shows the Projects pane Board view keeps folded under its navigation. */
async function showProjects(page: Page): Promise<void> {
	const rail = page.getByTestId("tool-rail-projects");
	if ((await rail.getAttribute("aria-pressed")) !== "true") await rail.click();
	await expect(rail).toHaveAttribute("aria-pressed", "true");
}

function projectWorkspace(page: Page, name: string): Locator {
	return page
		.getByTestId("project-group")
		.filter({ has: page.getByTestId("project-name").filter({ hasText: name }) })
		.getByTestId("workspace-item")
		.first();
}

async function dismissToasts(page: Page): Promise<void> {
	for (const toast of await page.getByTestId("toast").all())
		await toast.getByRole("button").last().click();
}

async function cardTab(page: Page, tab: "details" | "chat" | "review" | "activity") {
	await peekCard(page).getByTestId(`board-card-tab-${tab}`).click();
	await expect(peekCard(page).getByTestId("board-card-tabbed")).toHaveAttribute("data-tab", tab);
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

test("Board view creates a card, edits it in Peek and starts it into a new workspace whose chat takes the kickoff", async ({
	page,
}) => {
	const kickoffs = observeKickoffs(page);
	await openBoard(page);
	await expect(boardTool(page).getByTestId("board-empty")).toContainText("No cards yet");
	await expect(boardTool(page).getByTestId("board-project")).not.toBeEmpty();

	await createCard(page, "Draft the board");
	await expect(column(page, "backlog").getByTestId("board-card")).toHaveCount(1);
	await expect(peekCard(page)).toBeVisible();
	await expect(peekCard(page).getByTestId("board-card-tabbed")).toHaveAttribute(
		"data-tab",
		"details",
	);
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
	await expect(column(page, "building").getByTestId("board-card")).toContainText("Ship the board");
	await cardTab(page, "activity");
	await expect(peekCard(page).getByTestId("board-activity-item").first()).toContainText(
		"automatically",
	);

	await expect
		.poll(kickoffs)
		.toContainEqual(expect.stringMatching(/^Card \w+-1: Ship the board\n/));
	expect(kickoffs().find((text) => text.includes("Ship the board"))).toContain(
		"Acceptance criteria:\n- Cards launch a workspace",
	);

	await cardTab(page, "details");
	await dismissToasts(page);
	await peekCard(page).getByTestId("board-attempt-chat").click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(boardTool(page)).toBeHidden();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "false");
	await expect(worktreeRows(page)).toHaveCount(1);
	await enterBoardView(page);
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

	await card(page, "Follow me").getByTestId("board-card-open").click();
	await expect(peekCard(page)).toBeVisible();
	await expect(boardTool(page)).toBeVisible();
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
	await expect(peekCard(page)).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(boardTool(page)).toBeHidden();

	await enterBoardView(page);
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
	await cardTab(page, "activity");
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

test("switching the extension off shows the placeholder in Board view's center and side tools, and keeps the view", async ({
	page,
}) => {
	await openBoard(page);
	await createCard(page, "Survives the switch");
	const center = page.getByTestId("extension-view-center");
	const nav = page.locator('[data-tool-body="ext:board:nav"]');
	await expect(nav.getByTestId("board-nav")).toBeVisible();

	await setBoardExtension(page, false);
	await expect(center.getByTestId("extension-panel-disabled")).toBeVisible();
	await expect(nav.getByTestId("extension-panel-disabled")).toBeVisible();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveCount(0);
	await expect(page.getByTestId("view-exit")).toBeVisible();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(center.getByTestId("extension-panel-disabled")).toBeVisible();

	await setBoardExtension(page, true);
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	await expect(card(page, "Survives the switch")).toBeVisible();
});

test("screenshots: Board view on every region, the roadmap at full width, and a card in Peek", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
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
	await card(page, titles[1]).getByTestId("board-card-open").click();
	await expect(peekCard(page)).toBeVisible();
	await expect(page.getByTestId("board-feed-item").first()).toBeVisible();
	await page.mouse.move(0, 0);
	await shot(page, "board", "board-view");

	const startedId = await card(page, titles[0]).getAttribute("data-card-id");
	if (!startedId) throw new Error("the started card has no id");
	await boardTool(page).getByTestId("board-view-roadmap").click();
	await expect(boardTool(page).getByTestId("board-horizon")).toHaveCount(3);
	await newInitiative(page, "now", "Planning surface");
	await peekInitiative(page).getByTestId("board-initiative-add-card").selectOption(startedId);
	await newInitiative(page, "next", "Session insights");
	await newInitiative(page, "later", "OpenSpec in the graph");
	await expect(page.getByTestId("board-nav").getByTestId("board-nav-initiative")).toHaveCount(3);
	await page.mouse.move(0, 0);
	await shot(page, "board", "board-view-roadmap");
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
	await rows.filter({ hasText: "SP-1" }).getByTestId("board-inbox-workspace").click();
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

	await counter.click();
	await popover.getByTestId("board-inbox-open-board").click();
	await expect(popover).toBeHidden();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	const strip = boardTool(page).getByTestId("board-inbox-strip");
	await expect(strip.getByTestId("board-inbox-row")).toHaveCount(3);
	await expect(card(page, "Pick the rollout").getByTestId("board-agent-badge")).toHaveAttribute(
		"data-badge",
		"waiting",
	);
	await expect(card(page, "Shard the e2e suite").getByTestId("board-agent-badge")).toHaveAttribute(
		"data-badge",
		"failed",
	);
	await expect(page.getByTestId("board-agents").getByTestId("board-agent")).toHaveCount(3);
	await shot(page, "board", "inbox-strip");

	await strip
		.getByTestId("board-inbox-row")
		.filter({ hasText: "BS-1" })
		.getByTestId("board-inbox-answer")
		.click();
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");
	await expect(peekCard(page)).toHaveAttribute("data-card-id", "BS-1");
	await expect(peekCard(page).getByTestId("board-card-tabbed")).toHaveAttribute("data-tab", "chat");
	await expect(peekCard(page).getByTestId("board-card-chat")).toHaveAttribute(
		"data-session-id",
		"board-e2e-second-question",
	);
});

test("an agent's question is answered from its card's Chat tab in Peek, never leaving Board view", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	seedQuestion(realpathSync(E2E_FIXTURE_REPO), "board-e2e-answer");
	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	seedBoard(project.id, "SP", [
		{
			id: "SP-1",
			title: "Pick the rollout",
			category: "started",
			column: "designing",
			rank: 1,
			attempt: { workspaceId: project.defaultId, sessionId: "board-e2e-answer" },
		},
	]);
	await reloadBoards(page);
	await enterDefaultWorkspace(page);
	await enterBoardView(page);
	await expect(page.getByTestId("peek-empty")).toHaveText("Select a card");
	const agent = page.getByTestId("board-agents").getByTestId("board-agent");
	await expect(agent).toHaveAttribute("data-state", "waiting");
	await agent.click();
	await expect(peekCard(page).getByTestId("board-card-tabbed")).toHaveAttribute("data-tab", "chat");
	const chat = peekCard(page).getByTestId("board-card-chat");
	const question = chat.locator('[data-testid="ask-user-question"][data-tone="active"]');
	await expect(question.getByTestId("ask-question-text")).toHaveText("Which rollout?", {
		timeout: 20_000,
	});
	await expect(chat.getByTestId("chat-composer")).toBeVisible();
	await page.mouse.move(0, 0);
	await shot(page, "board", "board-view-chat-in-peek");
	await question.getByTestId("ask-option").filter({ hasText: "Canary" }).click();
	await question.getByTestId("ask-submit").click();
	await expect(
		chat.locator('[data-testid="ask-user-question"][data-tone="answered"]'),
	).toBeVisible();
	await expect(boardTool(page)).toBeVisible();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
});

test("Board view takes every region — nav, its center, Peek and the activity below — and leaving it restores the exact previous layout", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const before = await layoutSnapshot(page);

	await enterBoardView(page);
	await expect(
		page.locator('[data-tool-body="ext:board:nav"]').getByTestId("board-nav"),
	).toBeVisible();
	await expect(
		page.locator('[data-tool-body="ext:board:activity"]').getByTestId("board-activity-tool"),
	).toBeVisible();
	await expect(page.getByTestId("center-override")).toHaveAttribute("data-region-kind", "center");
	await expect(page.getByTestId("peek-empty")).toBeVisible();
	await expect(page.getByTestId("center-group")).toHaveCount(0);
	await expect(page.getByTestId("view-exit")).toHaveText("Back to workbench");
	await createCard(page, "Card in Board view");
	const workbench = await page.getByTestId("workbench").boundingBox();
	const board = await boardTool(page).boundingBox();
	if (!workbench || !board) throw new Error("the board has no geometry");
	expect(board.width).toBeGreaterThan(workbench.width * 0.4);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	await expect(card(page, "Card in Board view")).toBeVisible();

	await page.getByTestId("view-exit").click();
	await expect(boardTool(page)).toBeHidden();
	await expect(page.getByTestId("view-exit")).toHaveCount(0);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	expect(await layoutSnapshot(page)).toEqual(before);

	await runPaletteCommand(page, "view.extensionView.enter.board:board", "Enter Board view");
	await expect(boardTool(page)).toBeVisible();
	await runPaletteCommand(page, "view.extensionView.exit", "Exit Board view");
	expect(await layoutSnapshot(page)).toEqual(before);

	await enterBoardView(page);
	await page.getByTestId(BOARD_VIEW_RAIL).click();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "false");
	expect(await layoutSnapshot(page)).toEqual(before);
});

test("Board view's navigation switches the project, narrows the cards to an initiative and a queue, and the view follows a workspace switch", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	await openSecondProject(page);
	const projects = await openProjects(page);
	const first = projects.find((project) => project.name === "sample-project");
	const other = projects.find((project) => project.name !== "sample-project");
	if (!first || !other) throw new Error("missing the two projects");
	seedBoard(first.id, "SP", [
		{ id: "SP-1", title: "In the initiative", category: "backlog", column: "backlog", rank: 1 },
		{ id: "SP-2", title: "Outside it", category: "review", column: "review", rank: 2 },
	]);
	seedInitiative(first.id, {
		id: "I-1",
		title: "Checkout",
		outcome: "Buyers pay in one step",
		criteria: [],
		cardIds: ["SP-1"],
	});
	seedBoard(other.id, "BS", [
		{ id: "BS-1", title: "Other project's card", category: "backlog", column: "backlog", rank: 1 },
	]);
	await reloadBoards(page);
	await projectWorkspace(page, "sample-project").click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await enterBoardView(page);
	const nav = page.getByTestId("board-nav");
	await expect(boardTool(page)).toHaveAttribute("data-project-id", first.id);
	await expect(nav.getByTestId("board-nav-project")).toHaveCount(2);
	await expect(boardTool(page).getByTestId("board-card")).toHaveCount(2);

	const initiative = nav.locator('[data-testid="board-nav-initiative"][data-initiative-id="I-1"]');
	await expect(initiative).toContainText("Checkout");
	await initiative.click();
	await expect(initiative).toHaveAttribute("aria-pressed", "true");
	await expect(boardTool(page).getByTestId("board-filters-active")).toContainText("I-1 · Checkout");
	await expect(boardTool(page).getByTestId("board-card")).toHaveCount(1);
	await expect(card(page, "In the initiative")).toBeVisible();
	await nav.getByTestId("board-nav-all").click();
	await expect(boardTool(page).getByTestId("board-card")).toHaveCount(2);
	await nav.getByTestId("board-nav-queue-review").click();
	await expect(nav.getByTestId("board-nav-queue-review")).toContainText("1/5");
	await expect(boardTool(page).getByTestId("board-card")).toHaveCount(1);
	await expect(card(page, "Outside it")).toBeVisible();
	await boardTool(page).getByTestId("board-filters-clear").click();
	await expect(boardTool(page).getByTestId("board-card")).toHaveCount(2);

	await nav.locator(`[data-testid="board-nav-project"][data-project-id="${other.id}"]`).click();
	await expect(boardTool(page)).toHaveAttribute("data-project-id", other.id);
	await expect(boardTool(page).getByTestId("board-project")).toHaveText(other.name);
	await expect(card(page, "Other project's card")).toBeVisible();
	await expect(page.getByTestId("scope-project-name")).toHaveText("sample-project");

	await showProjects(page);
	await projectWorkspace(page, other.name).click();
	await expect(page.getByTestId("scope-project-name")).toHaveText(other.name);
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	await expect(boardTool(page)).toBeVisible();
});

test("the palette enters and leaves Board view, which offers its own side tools nowhere else", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(boardTool(page)).toHaveCount(0);
	await expect(page.getByTestId("tool-rail-ext:board:nav")).toHaveCount(0);
	await runPaletteCommand(page, "view.extensionView.enter.board:board", "Enter Board view");
	await expect(boardTool(page)).toBeVisible();
	await expect(page.getByTestId(BOARD_VIEW_RAIL)).toHaveAttribute("aria-pressed", "true");
	await runPaletteCommand(page, "view.extensionView.exit", "Exit Board view");
	await expect(boardTool(page)).toHaveCount(0);
	await expect(page.getByTestId("tool-rail-ext:board:nav")).toHaveCount(0);
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
	await enterBoardView(page);
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
	await enterBoardView(page);
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
	await enterBoardView(page);
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
	await expect(boardTool(page)).toBeHidden();

	await enterBoardView(page);
	await boardTool(page).getByTestId("board-view-board").click();
	await expect(
		card(page, "Wire the roadmap views").getByTestId("board-card-initiative"),
	).toHaveText("Roadmap views");
});

/** Writes a board's initiatives file as a host restart would find it. */
function seedInitiative(
	projectId: string,
	initiative: { id: string; title: string; outcome: string; criteria: string[]; cardIds: string[] },
): void {
	const dir = join(E2E_DATA_DIR, "extensions", "board", projectId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "initiatives.json"),
		JSON.stringify({
			version: 1,
			nextNumber: 2,
			nextUpdateNumber: 1,
			initiatives: [
				{
					...initiative,
					horizon: "now",
					rank: 1,
					specRefs: [],
					updates: [],
					externalCards: [],
					createdAt: BASE_TS,
					updatedAt: BASE_TS,
				},
			],
		}),
	);
}

/** The board's initiatives as `roadmap.get` answers them over the wire. */
async function wireInitiatives(
	page: Page,
	projectId: string,
): Promise<{ id: string; containerId?: string; autopilot?: unknown }[]> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const view = (await wire.request("extension.query", {
			extension: "board",
			method: "roadmap.get",
			params: { projectId },
		})) as { initiatives: { id: string; containerId?: string; autopilot?: unknown }[] };
		return view.initiatives;
	} finally {
		wire.close();
	}
}

test("Run initiative makes a container of its first ready card with an orchestrator, autopilot's switch persists, and Review past its limit pauses it", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1720, height: 1000 });
	await openFixtureProject(page);
	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	seedBoard(project.id, "AP", [
		{ id: "AP-1", title: "Pay page", category: "unstarted", column: "ready", rank: 1, size: "S" },
		{
			id: "AP-2",
			title: "Saved cards",
			category: "unstarted",
			column: "ready",
			rank: 2,
			size: "S",
		},
		{ id: "AP-3", title: "Shipped one", category: "review", column: "review", rank: 3 },
		{ id: "AP-4", title: "Shipped two", category: "review", column: "review", rank: 4 },
	]);
	seedInitiative(project.id, {
		id: "I-1",
		title: "Checkout",
		outcome: "Buyers pay in one step",
		criteria: ["One page"],
		cardIds: ["AP-1", "AP-2"],
	});
	await reloadBoards(page);
	await enterDefaultWorkspace(page);
	await enterBoardView(page);
	await showProjects(page);
	await boardTool(page).getByTestId("board-view-roadmap").click();
	await horizon(page, "now").getByTestId("board-initiative-open").click();
	await expect(peekInitiative(page)).toHaveAttribute("data-initiative-id", "I-1");
	const block = peekInitiative(page).getByTestId("board-initiative-autopilot");
	await expect(block.getByTestId("board-autopilot-state")).toHaveAttribute("data-state", "off");
	await expect(block.getByTestId("board-autopilot-ready")).toHaveCount(2);

	await block.getByTestId("board-initiative-run").click();
	await expect(block.getByTestId("board-initiative-open-container")).toBeVisible({
		timeout: 30_000,
	});
	await expect(block.getByTestId("board-initiative-container")).toHaveText(
		"Container “Checkout” · 1 workspace",
	);
	const group = page.getByTestId("container-group").filter({
		has: page.getByTestId("container-name").getByText("Checkout", { exact: true }),
	});
	await expect(group.getByTestId("container-member-count")).toHaveText("1");
	await expect(group.getByTestId("workspace-item")).toHaveCount(1);
	await expect(group.getByTestId("container-orchestrator")).toBeVisible({ timeout: 30_000 });
	await expect(block.getByTestId("board-autopilot-ready")).toHaveCount(1);
	await expect(block.getByTestId("board-autopilot-ready")).toHaveAttribute("data-card-id", "AP-2");
	expect((await wireInitiatives(page, project.id))[0]?.containerId).toBeTruthy();

	const toggle = block.getByTestId("board-initiative-autopilot-switch");
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await expect(block.getByTestId("board-autopilot-state")).toHaveAttribute("data-state", "on");

	await boardTool(page).getByTestId("board-view-board").click();
	await expect(card(page, "Pay page")).toHaveAttribute("data-column", "building");
	await boardTool(page).getByTestId("board-settings").click();
	await page.getByTestId("board-wip-limit-review").fill("1");
	await page.getByTestId("board-wip-save").click();
	await expect(block.getByTestId("board-autopilot-state")).toHaveAttribute("data-state", "paused");
	await expect(block.getByTestId("board-autopilot-state")).toHaveText(
		"Paused: Review is over its limit (2/1)",
	);
	await expect
		.poll(async () => (await wireInitiatives(page, project.id))[0]?.autopilot, {
			timeout: 15_000,
		})
		.toEqual({ on: true, pausedReason: { kind: "review", count: 2, limit: 1 } });

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(boardTool(page)).toBeVisible();
	await boardTool(page).getByTestId("board-view-roadmap").click();
	await horizon(page, "now").getByTestId("board-initiative-open").click();
	const reloaded = peekInitiative(page).getByTestId("board-initiative-autopilot");
	await expect(reloaded.getByTestId("board-initiative-autopilot-switch")).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await expect(reloaded.getByTestId("board-autopilot-state")).toHaveAttribute(
		"data-state",
		"paused",
	);

	await page
		.getByTestId("container-group")
		.filter({ has: page.getByTestId("container-name").getByText("Checkout", { exact: true }) })
		.getByTestId("container-item")
		.click({ button: "right" });
	await page.getByTestId("container-menu-overview").click();
	const overview = page
		.locator('[data-region-kind="peek"][data-open]')
		.getByTestId("container-overview");
	const section = overview.getByTestId("board-container-initiative");
	await expect(section).toHaveAttribute("data-initiative-id", "I-1");
	await expect(section).toContainText("I-1 · Checkout");
	await expect(section.getByTestId("board-autopilot-state")).toHaveText(
		"Paused: Review is over its limit (2/1)",
	);
	await expect(section.getByTestId("board-autopilot-agents")).toBeVisible();
});

function graphNode(page: Page, id: string): Locator {
	return boardTool(page).locator(`.react-flow__node[data-id="${id}"]`);
}

function graphEdge(page: Page, from: string, to: string): Locator {
	return boardTool(page).locator(
		`[data-testid="board-graph-edge"][data-from="${from}"][data-to="${to}"]`,
	);
}

/** A press, a stepped move and a release on the page, as a person drags on React Flow's canvas. */
async function dragBy(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 6, from.y, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}

async function centerOf(target: Locator): Promise<{ x: number; y: number }> {
	const box = await target.boundingBox();
	if (!box) throw new Error("the target has no geometry");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The screen point halfway along an edge's drawn path, where a click lands on the edge itself. */
async function edgeMiddle(edge: Locator): Promise<{ x: number; y: number }> {
	return edge.locator("path.react-flow__edge-path").evaluate((path: SVGPathElement) => {
		const point = path.getPointAtLength(path.getTotalLength() / 2);
		const matrix = path.getScreenCTM();
		if (!matrix) throw new Error("the edge is not drawn");
		const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
		return { x: screen.x, y: screen.y };
	});
}

const isoInDays = (days: number) =>
	new Date((Math.floor(Date.now() / 86_400_000) + days) * 86_400_000).toISOString().slice(0, 10);

test("the step graph draws linked cards over time, a drag pins a card, a drawn link and Delete edit the links, and the timeline shows the initiative", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1720, height: 1000 });
	await openBoard(page);
	const titles = ["Lay the rails", "Run the trains", "Paint the stations"];
	for (const title of titles) await createCard(page, title);
	const [rails, trains, stations] = await Promise.all(
		titles.map((title) => card(page, title).getAttribute("data-card-id")),
	);
	if (!rails || !trains || !stations) throw new Error("the cards have no ids");
	await card(page, "Lay the rails").getByTestId("board-card-open").click();
	await expect(peekCard(page).getByTestId("board-card-title")).toHaveValue("Lay the rails");
	await peekCard(page).getByTestId("board-card-add-block").selectOption(trains);
	await expect(peekCard(page).getByTestId("board-card-block")).toHaveText([trains]);
	await page.getByTestId("peek-close").click();
	await boardTool(page).getByTestId("board-view-roadmap").click();
	await newInitiative(page, "now", "Rail network");
	const network = await peekInitiative(page).getAttribute("data-initiative-id");
	await peekInitiative(page).getByTestId("board-initiative-target").fill(isoInDays(20));
	await peekInitiative(page).getByTestId("board-initiative-project-add").fill("Track");
	await peekInitiative(page).getByTestId("board-initiative-project-add").press("Enter");
	const project = peekInitiative(page).getByTestId("board-initiative-project");
	await project.getByTestId("board-initiative-milestone-add").fill("First train");
	await project.getByTestId("board-initiative-milestone-add").press("Enter");
	await project.getByTestId("board-initiative-project-assign").selectOption(rails);
	await expect(project).toContainText("1 card");
	await project.getByTestId("board-initiative-project-assign").selectOption(trains);
	await expect(project).toContainText("2 cards");
	await newInitiative(page, "next", "Stations");
	const stationsInitiative = await peekInitiative(page).getAttribute("data-initiative-id");
	await peekInitiative(page).getByTestId("board-initiative-add-card").selectOption(stations);
	await expect(
		peekInitiative(page).locator(
			`[data-testid="board-initiative-card"][data-card-id="${stations}"]`,
		),
	).toBeVisible();
	await page.getByTestId("peek-close").click();

	await boardTool(page).getByTestId("board-view-graph").click();
	await expect(boardTool(page).getByTestId("board-graph")).toBeVisible();
	await expect(boardTool(page).getByTestId("board-graph-node")).toHaveCount(3);
	await expect(boardTool(page).getByTestId("board-graph-milestone")).toHaveCount(1);
	await expect(graphEdge(page, rails, trains)).toHaveCount(1);
	await expect(boardTool(page).getByTestId("board-graph-kpi")).toContainText("First train");
	await expect(boardTool(page).getByTestId("board-graph-critical")).toContainText(rails);

	const station = graphNode(page, stations);
	const start = await centerOf(station);
	await dragBy(page, start, { x: start.x + 3 * 40, y: start.y + 18 });
	await expect(boardTool(page).getByTestId("board-graph-notice")).toContainText(
		`${stations} pinned to start`,
	);
	await expect(station.getByTestId("board-graph-pin")).toBeVisible();
	await station.click();
	await expect(peekCard(page).getByTestId("board-card-pinned")).toHaveAttribute(
		"data-start",
		isoInDays(3),
	);
	await page.getByTestId("peek-close").click();

	await dragBy(
		page,
		await centerOf(graphNode(page, trains).locator(".react-flow__handle-right")),
		await centerOf(station.locator(".react-flow__handle-left")),
	);
	await expect(graphEdge(page, trains, stations)).toHaveCount(1);
	await expect(graphEdge(page, trains, stations)).toHaveAttribute("data-conflict", "true");
	await page.mouse.move(0, 0);
	await shot(boardTool(page), "board", "step-graph");

	await dragBy(
		page,
		await centerOf(station.locator(".react-flow__handle-right")),
		await centerOf(graphNode(page, rails).locator(".react-flow__handle-left")),
	);
	await expect(boardTool(page).getByTestId("board-graph-notice")).toHaveAttribute(
		"data-tone",
		"error",
	);
	await expect(graphEdge(page, stations, rails)).toHaveCount(0);

	const link = graphEdge(page, rails, trains);
	const middle = await edgeMiddle(link);
	await page.mouse.click(middle.x, middle.y);
	await expect(link).toHaveAttribute("data-selected", "true");
	await page.keyboard.press("Delete");
	await expect(link).toHaveCount(0);
	await expect(boardTool(page).getByTestId("board-graph-notice")).toContainText(
		`${rails} no longer blocks ${trains}`,
	);

	await boardTool(page).getByTestId("board-view-timeline").click();
	const row = boardTool(page).locator(
		`[data-testid="board-timeline-row"][data-kind="initiative"][data-row-id="${network}"]`,
	);
	await expect(row.getByTestId("board-timeline-bar")).toBeVisible();
	await expect(row.getByTestId("board-timeline-target")).toHaveCount(1);
	await expect(row).toHaveAttribute("data-insufficient", "true");
	await expect(boardTool(page).getByTestId("board-timeline-insufficient")).toBeVisible();
	await expect(
		boardTool(page).locator(
			`[data-testid="board-timeline-edge"][data-to="initiative:${stationsInitiative}"]`,
		),
	).toHaveCount(1);
	await row.getByTestId("board-timeline-toggle").click();
	await expect(
		boardTool(page).locator('[data-testid="board-timeline-row"][data-kind="project"]'),
	).toHaveCount(1);
	await boardTool(page).getByTestId("board-graph-scale-weeks").click();
	await expect(row.getByTestId("board-timeline-target")).toBeInViewport();
	await page.mouse.move(0, 0);
	await shot(boardTool(page), "board", "timeline");
	await row.getByTestId("board-timeline-bar").click();
	await expect(peekInitiative(page)).toHaveAttribute("data-initiative-id", network ?? "");
});

/** A flow history: completions over the last weeks, work in progress (one past the SLE) and a backlog. */
function seedFlow(projectId: string): void {
	const now = Date.now();
	const day = 86_400_000;
	const lines: string[] = [];
	const log = (cardId: string, from: string | null, to: string, at: number) =>
		lines.push(
			JSON.stringify({
				cardId,
				from: from ? { category: from, column: from === "started" ? "building" : from } : null,
				to: {
					category: to,
					column: to === "started" ? "building" : to === "completed" ? "done" : to,
				},
				at,
				actor: "automation",
				reason: "seeded",
			}),
		);
	const cards: SeedCard[] = [];
	const done = [
		[30, 2],
		[24, 4],
		[18, 1],
		[12, 3],
		[9, 6],
		[5, 2],
		[3, 5],
		[1, 1],
	] as const;
	done.forEach(([ago, cycle], index) => {
		const id = `IN-${index + 1}`;
		const end = now - ago * day;
		log(id, null, "backlog", end - (cycle + 2) * day);
		log(id, "backlog", "started", end - cycle * day);
		log(id, "started", "review", end - day / 3);
		log(id, "review", "completed", end);
		cards.push({
			id,
			title: `Shipped ${index + 1}`,
			category: "completed",
			column: "done",
			rank: index,
		});
	});
	const open = [
		["IN-9", "started", 2],
		["IN-10", "started", 9],
		["IN-11", "review", 3],
		["IN-12", "backlog", 0],
	] as const;
	open.forEach(([id, category, age], index) => {
		log(id, null, "backlog", now - (age + 4) * day);
		if (category !== "backlog") log(id, "backlog", "started", now - age * day);
		if (category === "review") log(id, "started", "review", now - day);
		cards.push({
			id,
			title: `Open ${index + 1}`,
			category,
			column: category === "started" ? "building" : category,
			rank: 20 + index,
		});
	});
	seedBoard(projectId, "IN", cards);
	writeFileSync(
		join(E2E_DATA_DIR, "extensions", "board", projectId, "transitions.jsonl"),
		`${lines.join("\n")}\n`,
	);
}

test("Insights draws WIP, throughput, cycle time, work item age, cumulative flow and where time goes, or says there is not enough data", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1720, height: 1100 });
	await openBoard(page);
	await boardTool(page).getByTestId("board-view-insights").click();
	const charts = boardTool(page).getByTestId("board-insights-chart");
	await expect(charts).toHaveCount(6);
	await expect(
		boardTool(page).locator('[data-testid="board-insights-chart"][data-empty]'),
	).toHaveCount(6);
	await expect(charts.first().getByTestId("board-insights-empty")).toHaveText(
		"Not enough data yet — this fills in as cards move.",
	);

	const [project] = await openProjects(page);
	if (!project) throw new Error("missing the fixture project");
	seedFlow(project.id);
	await reloadBoards(page);
	await enterBoardView(page);
	await boardTool(page).getByTestId("board-view-insights").click();
	const chart = (name: string) =>
		boardTool(page).locator(`[data-testid="board-insights-chart"][data-chart="${name}"]`);
	await expect(
		boardTool(page).locator('[data-testid="board-insights-chart"][data-empty]'),
	).toHaveCount(0);
	for (const name of ["wip", "throughput", "cycle", "aging", "flow", "time"])
		await expect(chart(name).getByTestId("board-insights-svg")).toBeVisible();
	await expect(chart("wip").locator("svg title")).toHaveText("Work in progress");
	await expect(chart("cycle").getByTestId("board-insights-cycle-dot")).toHaveCount(8);
	await boardTool(page).getByTestId("board-insights-weeks-4").click();
	await expect
		.poll(() => chart("cycle").getByTestId("board-insights-cycle-dot").count())
		.toBeLessThan(8);
	await boardTool(page).getByTestId("board-insights-weeks-12").click();
	await expect(chart("cycle").getByTestId("board-insights-cycle-dot")).toHaveCount(8);
	await expect(chart("cycle").getByTestId("board-insights-p50")).toBeVisible();
	await expect(chart("cycle").getByTestId("board-insights-p85")).toBeVisible();
	await expect(chart("aging").getByTestId("board-insights-age-dot")).toHaveCount(3);
	await expect(chart("aging").getByTestId("board-insights-sle")).toBeVisible();
	await expect(
		chart("aging").locator('[data-testid="board-insights-age-dot"][data-over]'),
	).toHaveCount(1);
	await expect(chart("flow").getByTestId("board-insights-flow-band")).toHaveCount(5);
	await expect(chart("time").getByTestId("board-insights-time-segment").first()).toBeVisible();
	await page.mouse.move(0, 0);
	await shot(boardTool(page), "board", "insights");
});

test("Publish writes the roadmap snapshot into the Default workspace, and Close initiative starts its closing chat", async ({
	page,
}) => {
	const snapshot = join(realpathSync(E2E_FIXTURE_REPO), "ROADMAP.md");
	rmSync(snapshot, { force: true });
	await page.setViewportSize({ width: 1720, height: 1000 });
	const kickoffs = observeRoadmapChats(page);
	try {
		await openBoard(page);
		await boardTool(page).getByTestId("board-view-roadmap").click();
		await newInitiative(page, "now", "Flow insights");
		const id = await peekInitiative(page).getAttribute("data-initiative-id");
		if (!id) throw new Error("the initiative has no id");
		const outcome = "Everyone sees where the work waits";
		await peekInitiative(page).getByTestId("board-initiative-outcome").fill(outcome);
		await peekInitiative(page).getByTestId("board-initiative-outcome").press("Tab");
		await expect(peekInitiative(page).getByTestId("board-initiative-outcome")).toHaveValue(outcome);

		await boardTool(page).getByTestId("board-more-menu").click();
		await page.getByTestId("board-publish-open").click();
		const dialog = page.getByTestId("board-publish-dialog");
		await expect(dialog.getByTestId("board-publish-path")).toHaveValue("ROADMAP.md");
		await dialog.getByTestId("board-publish-submit").click();
		await expect(dialog.getByTestId("board-publish-done")).toContainText(
			"Wrote ROADMAP.md in the Default workspace. Commit it",
		);
		expect(existsSync(snapshot)).toBe(true);
		const text = readFileSync(snapshot, "utf8");
		expect(text).toMatch(
			/^# Roadmap — .+\n\nGenerated on \d{4}-\d{2}-\d{2} from the ThinkRail board/,
		);
		expect(text).toContain(`## Now\n\n### ${id} · Flow insights\n\n${outcome}\n`);
		expect(text).toContain("## Next\n\n_No initiatives._");
		expect(text).toContain("## Later");
		await dialog.getByTestId("board-publish-peek").click();
		await expect(dialog).toBeHidden();
		await expect(
			page.getByTestId("peek-pane").locator('[data-testid="peek-crumb"][data-current]'),
		).toContainText("ROADMAP.md");

		await boardTool(page).getByTestId("board-initiative-open").first().click();
		await expect(peekInitiative(page)).toHaveAttribute("data-initiative-id", id);
		await peekInitiative(page).getByTestId("board-initiative-chat-close").click();
		await expect.poll(kickoffs).toHaveLength(1);
		const [kickoff] = kickoffs();
		expect(kickoff?.startsWith(`/skill:initiative-close Close initiative ${id} of the`)).toBe(true);
		expect(kickoff).toContain(`Initiative ${id}: Flow insights\nOutcome: ${outcome}`);
	} finally {
		rmSync(snapshot, { force: true });
	}
});

const OPENSPEC_FIXTURE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"thinkrail-extensions",
	"board",
	"server",
	"openspec",
	"fixtures",
	"in-progress",
	"openspec",
);

test("an OpenSpec change is a card of the Spec-driven preset, read-only without the CLI, and Apply starts it on the apply skill", async ({
	page,
}) => {
	const repo = realpathSync(E2E_FIXTURE_REPO);
	const tree = join(repo, "openspec");
	rmSync(tree, { recursive: true, force: true });
	await page.setViewportSize({ width: 1720, height: 1000 });
	const kickoffs = observeKickoffs(page);
	try {
		await openFixtureProject(page);
		cpSync(OPENSPEC_FIXTURE, tree, { recursive: true });
		await enterDefaultWorkspace(page);
		await enterBoardView(page);
		await expect(boardTool(page).getByTestId("board-openspec-propose")).toBeVisible();

		await boardTool(page).getByTestId("board-preset").click();
		await page.getByTestId("board-preset-spec-driven").click();
		await expect(boardTool(page).getByTestId("board-preset")).toHaveAttribute(
			"data-preset",
			"spec-driven",
		);
		const change = card(page, "Add TOTP two-factor login");
		await expect(change).toHaveAttribute("data-source", "openspec");
		await expect(change).toHaveAttribute("data-column", "in-progress");
		await expect(column(page, "in-progress").getByTestId("board-card")).toHaveCount(1);
		await expect(change.getByTestId("board-openspec-tasks")).toContainText("3/7 tasks");
		await expect(change.getByTestId("board-openspec-delta")).toHaveText([
			/audit-log\s*\+1/,
			/auth\s*\+2 ~1/,
		]);
		await expect(change.getByTestId("board-openspec-artifact")).toHaveCount(4);
		await expect(
			change.locator('[data-testid="board-openspec-artifact"][data-status="done"]'),
		).toHaveCount(4);
		await expect(boardTool(page).getByTestId("board-openspec-install")).toContainText(
			"npm install -g @fission-ai/openspec",
		);

		await change.getByTestId("board-card-open").click();
		const panel = peekCard(page);
		const section = panel.getByTestId("board-openspec-section");
		await expect(section).toHaveAttribute("data-stage", "in-progress");
		await expect(section.getByTestId("board-openspec-validate")).toBeDisabled();
		await expect(section.getByTestId("board-openspec-install")).toBeVisible();
		await section.getByTestId("board-openspec-tab-tasks").click();
		await expect(section.getByTestId("board-openspec-task-lines").locator("li")).toHaveCount(7);
		await section.getByTestId("board-openspec-tab-specs").click();
		await expect(section.getByTestId("board-openspec-capability")).toHaveCount(2);
		await page.mouse.move(0, 0);
		await shot(page, "board", "openspec-board");

		await section.getByTestId("board-openspec-apply").click();
		await expect(section.getByTestId("board-openspec-outcome")).toBeVisible({ timeout: 30_000 });
		await expect
			.poll(kickoffs)
			.toContainEqual(
				expect.stringMatching(
					/^\/skill:openspec-apply-change add-2fa-login\n\nCard \w+-1: Add TOTP two-factor login\n/,
				),
			);
		const applied = card(page, "Add TOTP two-factor login");
		await expect(applied).not.toHaveAttribute("data-virtual", "true");
		await expect(applied).toHaveAttribute("data-column", "in-progress");
		const cardId = await applied.getAttribute("data-card-id");
		const [project] = await openProjects(page);
		if (!project || !cardId) throw new Error("missing the project or the stored card");
		const wire = await E2eWire.connect(Number(new URL(page.url()).port));
		let worktree = "";
		let workspaceId = "";
		try {
			const workspaces = await wire.request("workspace.list", { projectId: project.id });
			const attempt = workspaces.find((workspace) => workspace.kind !== "default");
			worktree = attempt?.worktreePath ?? "";
			workspaceId = attempt?.id ?? "";
		} finally {
			wire.close();
		}
		const metadata = join(worktree, "openspec", "changes", "add-2fa-login", ".openspec.yaml");
		await expect.poll(() => existsSync(metadata)).toBe(true);
		expect(readFileSync(metadata, "utf8")).toContain(
			`goal: Add TOTP two-factor login\nx-thinkrail:\n  card: ${cardId}\n  workspace: ${workspaceId}\n`,
		);
		expect(existsSync(join(worktree, "openspec", "changes", "add-2fa-login", "tasks.md"))).toBe(
			true,
		);
		await expect(applied.getByTestId("board-openspec-tasks")).toContainText("3/7 tasks");
	} finally {
		rmSync(tree, { recursive: true, force: true });
	}
});

test("Smart review checks a started card against its criteria, comments the unmet one in the workspace's Review, and adds its packet to the PR", async ({
	page,
}) => {
	await openBoard(page);
	await createCard(page, "Greet in French");
	const panel = peekCard(page);
	for (const [index, criterion] of ["Greets in French", "Says goodbye"].entries()) {
		await panel.getByTestId("board-card-acceptance-add").fill(criterion);
		await panel.getByTestId("board-card-acceptance-add").press("Enter");
		await expect(panel.getByTestId("board-card-acceptance-item")).toHaveCount(index + 1);
	}
	await panel.getByTestId("board-start-submit").click();
	await expect(panel.getByTestId("board-attempt")).toHaveCount(1, { timeout: 30_000 });

	const [project] = await openProjects(page);
	if (!project) throw new Error("no open project");
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	const workspaces = await wire.request("workspace.list", { projectId: project.id });
	const attempt = workspaces.find((workspace) => workspace.kind !== "default");
	const worktree = attempt?.worktreePath ?? "";
	if (!attempt || !worktree) throw new Error("the card's workspace is missing");
	writeFileSync(
		join(worktree, "greet.ts"),
		'export const hello = "bonjour";\nexport const bye = "";\n',
	);
	gitAs(worktree, "add", "greet.ts");
	gitAs(worktree, "commit", "-q", "-m", "feat: greet in French");
	mkdirSync(join(worktree, ".thinkrail", "context"), { recursive: true });
	writeFileSync(
		join(worktree, ".thinkrail", "context", "e2e-reviewer.json"),
		[
			"Checked both criteria.",
			"```json",
			JSON.stringify({
				summary: "The greeting is French; the goodbye is missing.",
				items: [
					{
						id: "ac-1",
						verdict: "met",
						evidence: [{ path: "greet.ts", line: 1, note: "bonjour" }],
						tests: [],
					},
					{
						id: "ac-2",
						verdict: "unmet",
						evidence: [{ path: "greet.ts", line: 2, note: "bye is empty" }],
						tests: [],
					},
				],
			}),
			"```",
		].join("\n"),
	);
	const origin = githubOrigin(worktree);
	try {
		const branch = gitAs(worktree, "rev-parse", "--abbrev-ref", "HEAD");
		gitAs(worktree, "push", "-q", "--set-upstream", "origin", branch);
		writeGhScenario({
			prs: [{ number: 128, headRefName: branch, state: "OPEN", body: "Adds the greeting." }],
		});
		await wire.request("workspace.openReview", { workspaceId: attempt.id, allowCached: false });
		await cardTab(page, "review");
		const section = panel.getByTestId("board-review-section");
		await expect(section.getByTestId("board-packet-to-pr")).toBeEnabled({ timeout: 30_000 });

		await section.getByTestId("board-review-run").click();
		const rows = section.getByTestId("board-review-item");
		await expect(rows).toHaveCount(2, { timeout: 30_000 });
		await expect(rows.nth(0)).toHaveAttribute("data-verdict", "met");
		await expect(rows.nth(1)).toHaveAttribute("data-verdict", "unmet");
		await expect(rows.nth(1).getByTestId("board-review-evidence")).toHaveText("greet.ts:2");
		await expect(section.getByTestId("board-review-tally")).toHaveText("1/2 met");
		await expect(card(page, "Greet in French").getByTestId("board-conformance")).toHaveText(
			"1/2 met",
		);
		await expect(section.getByTestId("board-packet")).toContainText("Goal: Greet in French");
		for (const toast of await page.getByTestId("toast").all())
			await toast.getByRole("button").last().click();
		await page.mouse.move(0, 0);
		await shot(page, "board", "smart-review");

		await section.getByTestId("board-packet-to-pr").click();
		await expect(section.getByTestId("board-packet-outcome")).toHaveText(
			"Added the review packet to PR #128.",
		);
		const body = readGhScenario().prs[0]?.body ?? "";
		expect(
			body.startsWith("Adds the greeting.\n\n<!-- thinkrail:review-packet -->\n## Review packet"),
		).toBe(true);
		expect(body).toContain("| Says goodbye | ❌ unmet | `greet.ts:2` bye is empty | — |");
		expect(body.endsWith("<!-- /thinkrail:review-packet -->\n")).toBe(true);
		await section.getByTestId("board-packet-to-pr").click();
		await expect(section.getByTestId("board-packet-outcome")).toHaveText(
			"PR #128 already carries this review packet.",
		);
		expect(ghCalls().filter((argv) => argv[0] === "pr" && argv[1] === "edit")).toHaveLength(1);

		await section.getByTestId("board-review-comments").click();
		await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
		const file = page
			.getByTestId("review-panel")
			.getByTestId("review-file-section")
			.filter({ has: page.getByTestId("review-file-row").filter({ hasText: "greet.ts" }) });
		await expect(file.getByTestId("review-file-row")).toContainText("1 draft");
		for (const toast of await page.getByTestId("toast").all())
			await toast.getByRole("button").last().click();
		if ((await file.getAttribute("data-expanded")) !== "true")
			await file.getByTestId("review-file-row").click();
		const comment = file.getByTestId("review-comment");
		await expect(comment).toHaveCount(1);
		await expect(comment).toContainText("Unmet requirement: Says goodbye");
		await expect(comment.getByTestId("review-comment-agent")).toHaveText("Smart review");
	} finally {
		wire.close();
		origin.dispose();
	}
});

function peekIdea(page: Page): Locator {
	return page.getByTestId("peek-pane").getByTestId("board-idea-panel");
}

test("Discovery: an idea with a URL and scores lands in its quadrant, Promote shapes it, and the watchlist asks what changed and diffs its snapshots", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1720, height: 1100 });
	const kickoffs = observeRoadmapChats(page);
	await openBoard(page);
	await boardTool(page).getByTestId("board-view-discovery").click();
	const discovery = boardTool(page).getByTestId("board-discovery");
	await expect(discovery.getByTestId("board-discovery-empty")).toBeVisible();

	await discovery.getByTestId("board-idea-new").click();
	await discovery.getByTestId("board-idea-new-title").fill("Offline mode");
	await discovery.getByTestId("board-idea-new-title").press("Enter");
	await expect(peekIdea(page).getByTestId("board-idea-title")).toHaveValue("Offline mode");
	const id = await peekIdea(page).getAttribute("data-idea-id");
	if (!id) throw new Error("the idea has no id");
	const pitch = "Work on a plane, with no connection, and sync when back online";
	await peekIdea(page).getByTestId("board-idea-pitch").fill(pitch);
	await peekIdea(page).getByTestId("board-idea-pitch").press("Tab");
	await expect(peekIdea(page).getByTestId("board-idea-pitch")).toHaveValue(pitch);

	await peekIdea(page)
		.getByTestId("board-idea-evidence-ref")
		.fill("https://example.com/forum/offline-mode");
	await peekIdea(page).getByTestId("board-idea-evidence-quote").fill("Please add an offline mode");
	await peekIdea(page).getByTestId("board-idea-evidence-add").click();
	await expect(peekIdea(page).getByTestId("board-idea-evidence-link")).toHaveAttribute(
		"href",
		"https://example.com/forum/offline-mode",
	);
	await expect(peekIdea(page).getByTestId("board-idea-evidence")).toContainText(
		"Please add an offline mode",
	);

	await peekIdea(page).getByTestId("board-idea-value-score").selectOption("5");
	await expect(peekIdea(page).getByTestId("board-idea-value-score")).toHaveValue("5");
	await peekIdea(page).getByTestId("board-idea-effort-score").selectOption("1");
	await expect(peekIdea(page).getByTestId("board-idea-effort-score")).toHaveValue("1");
	const dot = discovery.locator(`[data-testid="board-discovery-dot"][data-idea-id="${id}"]`);
	await expect(dot).toHaveAttribute("data-quadrant", "quick-win");
	await expect(dot).not.toHaveAttribute("data-suggested", "true");
	await expect(
		discovery.locator(`[data-testid="board-idea-row"][data-idea-id="${id}"]`),
	).toContainText("V 5");
	await expect(
		discovery
			.locator(`[data-testid="board-idea-row"][data-idea-id="${id}"]`)
			.getByTestId("board-idea-status"),
	).toHaveAttribute("data-status", "analyzed");

	await peekIdea(page).getByTestId("board-idea-chat-promote").click();
	await expect.poll(kickoffs).toHaveLength(1);
	const [shape] = kickoffs();
	expect(shape?.startsWith(`/skill:roadmap-shape Shape idea ${id} of the`)).toBe(true);
	expect(shape).toContain(`Idea ${id}: Offline mode\nPitch: ${pitch}`);
	expect(shape).toContain(
		'- E-1 (url) https://example.com/forum/offline-mode: "Please add an offline mode"',
	);
	expect(shape).toContain(`ideaId: "${id}"`);
	await expect(boardTool(page)).toBeHidden();
	await enterBoardView(page);

	await discovery.getByTestId("board-watch-new").click();
	await discovery.getByTestId("board-watch-new-name").fill("Linear");
	await discovery.getByTestId("board-watch-new-urls").fill("https://linear.app/changelog");
	await discovery.getByTestId("board-watch-new-notes").fill("Cycles and their pricing");
	await discovery
		.getByTestId("board-watch-new-form")
		.getByRole("button", { name: "Add competitor" })
		.click();
	const entry = discovery.getByTestId("board-watch-entry");
	await expect(entry).toHaveCount(1);
	await expect(entry.getByTestId("board-watch-name")).toHaveValue("Linear");
	await expect(entry.getByRole("link", { name: "https://linear.app/changelog" })).toBeVisible();
	const watchId = await entry.getAttribute("data-watch-id");
	await entry.getByTestId("board-watch-changed").click();
	await expect.poll(kickoffs).toHaveLength(2);
	const watch = kickoffs()[1];
	expect(
		watch?.startsWith(`/skill:competitor-watch Check what changed at Linear (${watchId})`),
	).toBe(true);
	expect(watch).toContain("https://linear.app/changelog — Cycles and their pricing");
	await enterBoardView(page);

	const [project] = await openProjects(page);
	if (!project || !watchId) throw new Error("missing the project or the entry");
	const file = join(E2E_DATA_DIR, "extensions", "board", project.id, "watchlist.json");
	const stored = JSON.parse(readFileSync(file, "utf8")) as { entries: Record<string, unknown>[] };
	const day = 86_400_000;
	writeFileSync(
		file,
		JSON.stringify({
			...stored,
			entries: stored.entries.map((candidate) => ({
				...candidate,
				previous: {
					at: Date.now() - 7 * day,
					text: "Features: issues, projects\nPricing: $8 per seat\nReleases: none",
				},
				snapshot: {
					at: Date.now(),
					text: "Features: issues, projects, cycles\nPricing: $10 per seat\nReleases: none",
				},
			})),
		}),
	);
	await reloadBoards(page);
	await enterBoardView(page);
	await boardTool(page).getByTestId("board-view-discovery").click();
	const diff = boardTool(page).getByTestId("board-watch-diff");
	await expect(diff.locator('[data-kind="removed"]')).toContainText([
		"Features: issues, projects",
		"Pricing: $8 per seat",
	]);
	await expect(diff.locator('[data-kind="added"]')).toContainText([
		"Features: issues, projects, cycles",
		"Pricing: $10 per seat",
	]);
	await expect(diff.locator('[data-kind="same"]')).toContainText(["Releases: none"]);
	await boardTool(page)
		.locator(`[data-testid="board-idea-row"][data-idea-id="${id}"] button`)
		.click();
	await expect(peekIdea(page)).toHaveAttribute("data-idea-id", id);
	await page.mouse.move(0, 0);
	await shot(page, "board", "discovery");
});
