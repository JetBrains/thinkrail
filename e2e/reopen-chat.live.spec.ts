import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): needs a real session. Proves the "reopen closed chat" feature —
// closing a chat moves it to history (its session/runtime stay alive); reopening restores the full
// transcript and removes it from history. (The store-level guarantee is unit-tested in store/appStore.test.ts.)
test("a closed chat reopens from history with its transcript intact", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const history = page.getByTestId("chat-history");
	const userMsg = page
		.locator('[data-testid="chat-message"][data-role="user"]')
		.filter({ hasText: "pong" });

	// Start a chat and run a turn so it has content worth restoring.
	await page.getByTestId("start-chat").click();
	await expect(chatTabs).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 80_000 });
	await expect(userMsg).toBeVisible();

	// No history while the chat is open.
	await expect(history).toHaveCount(0);

	// Close it → it leaves the tab strip and shows up in chat history.
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);
	await expect(history).toBeVisible();

	// Reopen from history → the tab + its transcript return, and the history entry is consumed.
	await history.click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	await expect(userMsg).toBeVisible(); // full transcript restored (the runtime was never disposed)
	await expect(history).toHaveCount(0);
});
