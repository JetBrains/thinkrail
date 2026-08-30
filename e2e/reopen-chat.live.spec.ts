import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("a closed chat reopens from history with its transcript intact", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	const history = page.getByTestId("chat-history").first();
	const userMsg = page
		.locator('[data-testid="chat-message"][data-role="user"]')
		.filter({ hasText: "pong" });

	await expect(chatTabs).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 80_000 });
	await expect(userMsg).toBeVisible();

	await expect(history).toHaveCount(0);

	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);
	await expect(history).toBeVisible();

	await history.click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	await expect(userMsg).toBeVisible();
	await expect(history).toHaveCount(0);
});
