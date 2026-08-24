import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

test("the streaming loader shows a phase mid-turn and clears on done", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openWorkspaceChat(page);

	await page
		.getByTestId("chat-input")
		.fill("Use bash to run `sleep 2 && echo marker-42`, then tell me exactly what it printed.");
	await page.getByTestId("chat-send").click();

	const loader = page.getByTestId("stream-indicator");
	await expect(loader).toBeVisible({ timeout: 60_000 });
	await expect(
		page.locator('[data-testid="stream-indicator"][data-phase="running-tool"]'),
	).toBeVisible({ timeout: 60_000 });

	const assistant = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
	await expect(assistant).not.toBeEmpty({ timeout: 60_000 });
	await expect(page.getByTestId("chat-abort")).toHaveCount(0, { timeout: 60_000 });

	await expect(loader).toHaveCount(0);
	await expect(page.getByTestId("chat-scroll").getByText("▍")).toHaveCount(0);
});
