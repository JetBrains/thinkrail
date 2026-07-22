import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// No-agent: a sent user message appears client-side (appendUserMessage) before any agent reply, so the
// hover copy button on user messages is testable without a provider.

test("user messages have a hover copy button that copies the text", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await openWorkspaceChat(page);

	await page.getByTestId("chat-input").fill("hello from the user");
	await page.getByTestId("chat-send").click();

	const userMsg = page
		.locator('[data-testid="chat-message"][data-role="user"]')
		.filter({ hasText: "hello from the user" })
		.first();
	await expect(userMsg).toBeVisible();

	const copyBtn = userMsg.getByTestId("copy-user-message");
	await userMsg.hover();
	await copyBtn.click();

	// The message text lands on the clipboard, and the button flips to its "copied" confirmation.
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("hello from the user");
	await expect(copyBtn.locator("svg.text-green")).toBeVisible();
});
