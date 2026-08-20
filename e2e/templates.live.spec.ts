import { expect, test } from "@playwright/test";
import { activeWorktreeRow, openWorkspaceChat, waitForDone } from "./fixtures/app";

test("picking the seeded template from the / menu sends the expanded text and gets a reply", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(90_000);
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");

	await input.fill("/rev");
	const rows = page.locator('[data-testid="slash-command"][data-source="prompt"]');
	await expect(rows).toHaveCount(1);
	await rows.first().click();
	await expect(input).toHaveValue(/^Review ⟨file⟩ for issues, focusing on src\/\.\s*$/);

	await page.keyboard.type("README.md");
	await expect(input).toHaveValue(/^Review README\.md for issues, focusing on src\/\.\s*$/);
	await input.press("Tab");
	await expect(page.getByTestId("slot-hint")).toContainText("slot 2/2");

	await page.getByTestId("chat-send").click();

	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toContainText("README.md");
	await expect(bubble).toContainText("src/");
	await expect(bubble).not.toContainText("⟨");
	await expect(bubble).not.toContainText("/review");

	await waitForDone(page);
});

test("a typed-through /name command is expanded by pi itself, not the composer's slot parser", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(120_000);
	await openWorkspaceChat(page);
	const input = page.getByTestId("chat-input");

	await input.click();
	await page.keyboard.type("/review alpha beta ");
	await expect(page.getByTestId("slash-menu")).toHaveCount(0);
	await page.keyboard.press("Enter");

	const bubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(bubble).toHaveText("/review alpha beta");

	await waitForDone(page);

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(activeWorktreeRow(page)).toHaveCount(1);

	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	const restoredBubble = page.locator('[data-testid="chat-message"][data-role="user"]').first();
	await expect(restoredBubble).toBeVisible();

	await expect(restoredBubble).toContainText("Review alpha for issues, focusing on beta.");
	await expect(restoredBubble).not.toContainText("/review");
});
