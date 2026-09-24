import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

const COUNT_PROMPT =
	"Count from 1 to 60, one number per line. No other text, no tools, just the numbers.";

test("queuing from chat while streaming adds a plan item the agent then works; interrupt sends now", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toHaveCount(1);

	const input = page.getByTestId("chat-input");
	const users = page.locator('[data-testid="chat-message"][data-role="user"]');
	const assistants = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	const strip = page.getByTestId("queue-strip");

	await input.fill(COUNT_PROMPT);
	await page.getByTestId("chat-send").click();
	await expect(input).toHaveAttribute("placeholder", /Enter steers at the next step/, {
		timeout: 60_000,
	});

	// Cmd/Ctrl+Enter while streaming no longer queues a pi follow-up: it adds a user plan item.
	await input.fill("Reply with exactly the single word QUEUEDOK when you work this plan item.");
	await input.press("ControlOrMeta+Enter");
	await expect(input).toHaveValue("");

	// It lands in the plan as a user-origin item — not as a "QUEUEDOK" follow-up row in the strip.
	await page.getByTestId("chat-plan-toggle").click();
	const popover = page.getByTestId("chat-plan-popover");
	const row = popover.getByTestId("todo-row").filter({ hasText: "QUEUEDOK" });
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute("data-status", "pending");
	await expect(row.getByTestId("todo-origin-user")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(popover).toHaveCount(0);

	// The agent finishes the count, is woken, and works the queued plan item.
	await expect(assistants.first()).toContainText("60", { timeout: 120_000 });
	await expect(assistants.last()).toContainText("QUEUEDOK", { timeout: 180_000 });

	// Interrupt (Cmd/Ctrl+Shift+Enter) still aborts the current response and sends now.
	await input.fill(
		"Count from 1 to 200, one number per line. No other text, no tools, just the numbers.",
	);
	await input.press("Enter");
	await expect(input).toHaveAttribute("placeholder", /Enter steers at the next step/, {
		timeout: 60_000,
	});
	await input.fill("Now reply with exactly the single word: INTERRUPTOK");
	await input.press("ControlOrMeta+Shift+Enter");
	await expect(users.last()).toContainText("INTERRUPTOK", { timeout: 60_000 });
	await expect(assistants.last()).toContainText("INTERRUPTOK", { timeout: 120_000 });
	await expect(page.getByTestId("chat-abort")).toBeHidden({ timeout: 60_000 });
	await expect(strip).toBeHidden();
});
