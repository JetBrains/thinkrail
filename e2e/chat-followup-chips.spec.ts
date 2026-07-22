import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// No-agent: the composer's always-present follow-up chip row renders (default/idle chips when the agent
// isn't busy) and clicking a chip submits its text as a user message. Chips are mocked (followUpChips.ts);
// no provider needed — clicking appends the user turn client-side even before any agent reply.

test("follow-up chips are present above the input and click-to-send", async ({ page }) => {
	await openWorkspaceChat(page);

	const chips = page.getByTestId("followup-chips");
	await expect(chips).toBeVisible();
	// Idle state: the default starter chips.
	const chip = page.getByTestId("followup-chip").filter({ hasText: "What's next?" });
	await expect(chip).toBeVisible();

	await chip.click();

	// The chip's text lands as a user message (same path as typing + send); the draft stays empty.
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').filter({
			hasText: "What should we do next?",
		}),
	).toBeVisible();
	await expect(page.getByTestId("chat-input")).toHaveValue("");
});
