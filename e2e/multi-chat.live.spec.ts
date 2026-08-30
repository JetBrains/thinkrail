import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("two chats in one workspace stream independently; closing one keeps the other", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const doneNotice = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });

	await expect(chatTabs).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: alpha");
	await page.getByTestId("chat-send").click();

	await page.getByTestId("new-chat").first().click();
	await expect(chatTabs).toHaveCount(2);
	await page.getByTestId("chat-input").fill("Reply with the single word: bravo");
	await page.getByTestId("chat-send").click();

	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	await chatTabs.first().locator("button").first().click();
	await expect(doneNotice).toBeVisible({ timeout: 90_000 });

	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(1);
	await expect(doneNotice).toBeVisible();
});
