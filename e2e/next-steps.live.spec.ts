import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

test("the agent ends a finished turn with suggest_next_steps and the chips send its suggestion", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	await openWorkspaceChat(page);

	const input = page.getByTestId("chat-input");
	await input.fill(
		"Add a one-line description of this project to the top of README.md, then suggest my next steps.",
	);
	await page.getByTestId("chat-send").click();

	const done = page.locator('[data-testid="turn-divider-status"][data-outcome="done"]');
	await expect(done).toHaveCount(1, { timeout: 120_000 });
	const chips = page.getByTestId("composer-suggestion");
	await expect(chips.first()).toBeVisible({ timeout: 20_000 });
	const first = ((await chips.first().textContent()) ?? "").trim();
	expect(first.length).toBeGreaterThan(0);

	const userTurns = page.locator('[data-testid="chat-message"][data-role="user"]');
	await chips.first().click();
	await expect(page.getByTestId("composer-suggestions")).toHaveCount(0);
	await expect(userTurns).toHaveCount(2);
	await expect(userTurns.last()).toContainText(first);
	await expect(input).toHaveValue("");
});
