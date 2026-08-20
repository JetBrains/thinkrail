import { expect, test } from "@playwright/test";
import {
	activeWorktreeRow,
	createWorkspaceViaDialog,
	openFixtureProject,
	worktreeRows,
} from "./fixtures/app";
import { seedExternalCwdSessions, seedWorkspaceSession } from "./fixtures/sessions";

test("selecting a same-workspace message hit opens the chat and flashes the matched row", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);

	seedWorkspaceSession(workspaceA.worktreePath, {
		messages: [
			{ role: "user", text: "audit the retry backoff", timestamp: 1_700_100_000_000 },
			{
				role: "assistant",
				text: "Audited the retry backoff and added a jittered ceiling so it never spins forever.",
				timestamp: 1_700_100_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);

	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.fill("jittered ceiling");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "jittered ceiling" });
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");
	await expect(hit).toBeVisible();
	await query.press("Enter");

	await expect(overlay).toBeHidden();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	const flashRow = page.locator("[data-flash]");
	await expect(flashRow).toBeVisible();
	await expect(flashRow).toContainText("jittered ceiling");
	await expect(page.locator("[data-flash]")).toHaveCount(0, { timeout: 5_000 });
});

test("selecting a cross-workspace message hit switches the active workspace and flashes the row", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspaceA.worktreePath, {
		messages: [
			{ role: "user", text: "review the changelog draft", timestamp: 1_700_200_000_000 },
			{
				role: "assistant",
				text: "Reviewed the changelog draft and tightened the wording on the migration notes.",
				timestamp: 1_700_200_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	await createWorkspaceViaDialog(page);
	const workspaces = worktreeRows(page);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(page.getByTestId("history-scope")).toHaveAttribute("data-scope", "all");
	await query.fill("migration notes");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "migration notes" });
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(hit).toBeVisible();
	await query.press("Enter");

	await expect(overlay).toBeHidden();
	await expect(workspaces.nth(0)).toHaveAttribute("data-active", "true");
	await expect(workspaces.nth(1)).not.toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	const flashRow = page.locator("[data-flash]");
	await expect(flashRow).toBeVisible();
	await expect(flashRow).toContainText("migration notes");
});

test("an unmapped message hit is a no-op — the overlay stays open and the active workspace is untouched", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	seedExternalCwdSessions();
	await page.waitForTimeout(2_100);

	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(page.getByTestId("history-scope")).toHaveAttribute("data-scope", "all");
	await query.fill("debounce window overlaps");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="message"]')
		.filter({ hasText: "debounce window overlaps" });
	await expect(page.getByTestId("history-expand-hint")).toBeVisible();
	await query.press("Tab");
	await expect(hit).toBeVisible();
	await expect(hit).toContainText("not a ThinkRail workspace");
	await query.press("Enter");

	await expect(overlay).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const workspaces = worktreeRows(page);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(workspaces.nth(0)).not.toHaveAttribute("data-active", "true");
});

test("searching a prompt's own words that an assistant reply also echoes shows only an assistant crumb in MESSAGES, and the prompt row gets a jump icon", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspaceA.worktreePath, {
		messages: [
			{ role: "user", text: "refactor the auth middleware", timestamp: 1_700_700_000_000 },
			{
				role: "assistant",
				text: "Refactored the auth middleware to extract the token check into its own helper.",
				timestamp: 1_700_700_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.fill("auth middleware");
	await query.press("Tab");
	await expect(overlay).toHaveAttribute("data-stage", "zoomed");

	const promptRow = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "refactor the auth middleware" });
	await expect(promptRow).toBeVisible();
	await expect(promptRow.getByTestId("history-jump")).toBeVisible();
	await expect(promptRow.getByTestId("history-jump-shortcut")).toHaveText("⇧⏎");

	const messageRows = page.locator('[data-testid="history-item"][data-kind="message"]');
	await expect(messageRows).toHaveCount(1);
	await expect(messageRows.filter({ hasText: "assistant" })).toHaveCount(1);
	await expect(messageRows).toContainText("Refactored the auth middleware");
});

test("Shift+Enter on the selected prompt row jumps to the chat and flashes the matching USER turn", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspaceA = await createWorkspaceViaDialog(page);
	seedWorkspaceSession(workspaceA.worktreePath, {
		messages: [
			{
				role: "user",
				text: "investigate the zephyr7000 regression",
				timestamp: 1_700_800_000_000,
			},
			{
				role: "assistant",
				text: "Looked into it — turned out to be a stale cache entry.",
				timestamp: 1_700_800_001_000,
			},
		],
	});
	await page.waitForTimeout(2_100);

	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.fill("zephyr7000");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "zephyr7000" });
	await expect(hit).toBeVisible();
	await expect(hit.getByTestId("history-jump")).toBeVisible();
	await expect(hit.getByTestId("history-jump-shortcut")).toHaveText("⇧⏎");

	await query.press("Shift+Enter");

	await expect(overlay).toBeHidden();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(2);
	const flashRow = page.locator("[data-flash]");
	await expect(flashRow).toBeVisible();
	await expect(flashRow).toContainText("investigate the zephyr7000 regression");
	await expect(page.locator("[data-flash]")).toHaveCount(0, { timeout: 5_000 });
});

test("an unmapped prompt hit shows no jump icon, and Shift+Enter on it is a no-op", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await createWorkspaceViaDialog(page);
	seedExternalCwdSessions();
	await page.waitForTimeout(2_100);

	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-input").press("Control+r");
	const overlay = page.getByTestId("history-overlay");
	await expect(overlay).toBeVisible();
	const query = page.getByTestId("history-query");
	await query.press("Control+r");
	await query.press("Control+r");
	await expect(page.getByTestId("history-scope")).toHaveAttribute("data-scope", "all");
	await query.fill("flaky watcher");
	const hit = page
		.locator('[data-testid="history-item"][data-kind="prompt"]')
		.filter({ hasText: "flaky watcher" });
	await expect(hit).toBeVisible();
	await expect(hit.getByTestId("history-jump")).toHaveCount(0);
	await expect(hit.getByTestId("history-jump-shortcut")).toHaveCount(0);

	await query.press("Shift+Enter");

	await expect(overlay).toBeVisible();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const workspaces = worktreeRows(page);
	await expect(workspaces.nth(1)).toHaveAttribute("data-active", "true");
	await expect(workspaces.nth(0)).not.toHaveAttribute("data-active", "true");
});
