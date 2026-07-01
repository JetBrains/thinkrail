import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent to make a file change, then proves the
// chat turn-divider (Task 9) — it appears the instant the turn ends (no follow-up needed), and its "files
// changed" chip deep-links the right panel's Changes view to the edited file's diff.

test("turn-divider files-changed chip opens the file's diff in the Changes panel", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	// One turn: make a real change so the round has a "files changed" entry.
	await page
		.getByTestId("chat-input")
		.fill(
			"Use the write tool to create a new file notes.txt whose only content is the line: hello",
		);
	await page.getByTestId("chat-send").click();
	// Tool cards are collapsed by default — assert the card header (always rendered), not its body.
	await expect(page.locator('[data-testid="tool-card"][data-tool="write"]').first()).toBeVisible({
		timeout: 90_000,
	});
	await expect(
		page.locator('[data-testid="chat-message"][data-role="system"]').filter({ hasText: "Done" }),
	).toBeVisible({ timeout: 90_000 });

	// The divider closes the round the instant it ends — no follow-up turn required.
	const chip = page.getByTestId("turn-divider-files").first();
	await expect(chip).toBeVisible({ timeout: 30_000 });
	await expect(chip).toContainText("file changed");

	// Clicking it flips the right panel to Changes and shows notes.txt's diff.
	await chip.click();
	await expect(page.getByTestId("tab-changes")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("change-item").filter({ hasText: "notes.txt" })).toBeVisible();
	await expect(page.getByTestId("diff-viewer")).toContainText("hello");
});
