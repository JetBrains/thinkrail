import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to prove the in-chat TODO plan end to
// end. The plan is the agent's plan for the conversation, shown in the chat's plan popup (opened from the
// header strip). (1) The agent maintains it (todo_write/todo_update) and it reaches done LIVE (no manual
// refresh); (2) the user can add an item in the popup and the add nudges the agent to pick it up.
// Assertions are on outcomes (rows + data-status), not on which tool the agent chose.
test("the agent maintains the chat's TODO plan live, and picks up a user-added item", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openWorkspaceChat(page);

	// A tiny, fully-specified plan it can complete immediately (no real work, so the turn is short).
	await page
		.getByTestId("chat-input")
		.fill(
			'Use todo_write to create a TODO plan with one group titled "Demo" containing exactly two items titled "Alpha" and "Beta". Then do no other work — just mark both done with todo_update.',
		);
	await page.getByTestId("chat-send").click();
	await waitForDone(page, 150_000);

	// Open the in-chat plan popup. The plan reads as a status flow; once every step is done the whole
	// task drops under the "Done" label at the bottom as its own foldable row (live, no manual refresh) —
	// expand that task to see its steps.
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

	// The user adds an item in the popup. The add nudges the agent (no manual chat message), and the agent
	// works it to done. A finished user (loose) item lists plainly under the Done label, so it's visible.
	await popover.getByTestId("todo-add-input").fill("Reply with the single word ACK");
	await popover.getByTestId("todo-add-input").press("Enter");
	await expect(popover.getByTestId("todo-row").filter({ hasText: "ACK" })).toHaveAttribute(
		"data-status",
		"done",
		{ timeout: 120_000 },
	);
	// …but the wake-up prompt itself is hidden: it never shows as a user message in the transcript.
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="user"]')
			.filter({ hasText: "TODO was added" }),
	).toHaveCount(0);
});
