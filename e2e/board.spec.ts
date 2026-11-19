import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
	worktreeRows,
} from "./fixtures/app";
import { shot } from "./fixtures/screenshots";

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
