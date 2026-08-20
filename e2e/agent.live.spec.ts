import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("streams an assistant reply from a real provider", { tag: "@agent" }, async ({ page }) => {
	test.setTimeout(90_000);
	await openFixtureProject(page);

	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await page.getByTestId("chat-input").fill("Reply with the single word: pong");
	await page.getByTestId("chat-send").click();

	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').first();
	await expect(assistant).toBeVisible({ timeout: 60_000 });
	await expect(assistant).not.toBeEmpty({ timeout: 60_000 });
});
