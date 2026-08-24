import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

test("markdown links in an assistant reply open in a new tab", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000);

	await openWorkspaceChat(page);

	const url = "https://example.com/thinkrail-link-test";
	await page
		.getByTestId("chat-input")
		.fill(`Reply with exactly this markdown and nothing else: [Example](${url})`);
	await page.getByTestId("chat-send").click();

	const link = page
		.locator('[data-testid="chat-message"][data-role="assistant"]')
		.locator(`a[href="${url}"]`)
		.first();
	await expect(link).toBeVisible({ timeout: 60_000 });

	await expect(link).toHaveAttribute("target", "_blank");
	await expect(link).toHaveAttribute("rel", /noopener/);
});
