import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

test("the agent maintains the chat's TODO plan live, and picks up a user-added item", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openWorkspaceChat(page);

	await page
		.getByTestId("chat-input")
		.fill(
			'Use todo_write to create a TODO plan with one group titled "Demo" containing exactly two items titled "Alpha" and "Beta". Then do no other work — just mark both done with todo_update.',
		);
	await page.getByTestId("chat-send").click();
	await waitForDone(page, 150_000);

	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	const doneGroup = popover.getByTestId("todo-group-done").filter({ hasText: "Demo" });
	await expect(doneGroup).toBeVisible({ timeout: 15_000 });
	await doneGroup.click();
	await expect(popover.getByTestId("todo-row").filter({ hasText: "Alpha" })).toHaveAttribute(
		"data-status",
		"done",
	);
	await expect(popover.getByTestId("todo-row").filter({ hasText: "Beta" })).toHaveAttribute(
		"data-status",
		"done",
	);

	await popover.getByTestId("todo-add-input").fill("Reply with the single word ACK");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: "ACK" })).toHaveAttribute(
		"data-status",
		"done",
		{ timeout: 120_000 },
	);
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "TODO was added" }),
	).toHaveCount(0);
});
