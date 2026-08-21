import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

const COUNT_PROMPT =
	"Count from 1 to 60, one number per line. No other text, no tools, just the numbers.";

test("Cmd/Ctrl+Enter queues via the pending strip; the follow-up runs after the turn at canonical position; dequeue restores the composer", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);

	const input = page.getByTestId("chat-input");
	const users = page.locator('[data-testid="chat-message"][data-role="user"]');
	const assistants = page.locator('[data-testid="chat-message"][data-role="assistant"]');
	const strip = page.getByTestId("queue-strip");

	await input.fill(COUNT_PROMPT);
	await page.getByTestId("chat-send").click();
	await expect(input).toHaveAttribute("placeholder", /Cmd\/Ctrl\+Enter to queue/, {
		timeout: 60_000,
	});

	await input.fill("Now reply with exactly the single word: QUEUEDOK");
	await input.press("ControlOrMeta+Enter");

	await expect(input).toHaveValue("");
	await expect(strip).toBeVisible();
	await expect(page.getByTestId("queue-item")).toContainText("QUEUEDOK");
	await expect(page.getByTestId("queue-item")).toHaveAttribute("data-kind", "followUp");
	await expect(users).toHaveCount(1);

	await expect(assistants.last()).toContainText("QUEUEDOK", { timeout: 120_000 });
	await expect(strip).toBeHidden();
	await expect(users).toHaveCount(2);
	await expect(assistants.first()).toContainText("60");

	const roles = await page
		.locator('[data-testid="chat-message"]')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-role")));
	const conversational = roles.filter((role) => role === "user" || role === "assistant");
	const firstAssistant = conversational.indexOf("assistant");
	const queuedUser = conversational.indexOf("user", 1);
	expect(firstAssistant).toBeGreaterThan(0);
	expect(queuedUser).toBeGreaterThan(firstAssistant);

	await input.fill(COUNT_PROMPT);
	await input.press("Enter");
	await expect(users).toHaveCount(3, { timeout: 60_000 });
	await expect(input).toHaveAttribute("placeholder", /Cmd\/Ctrl\+Enter to queue/, {
		timeout: 60_000,
	});

	await input.fill("first queued edit");
	await input.press("ControlOrMeta+Enter");
	await input.fill("second queued edit");
	await input.press("ControlOrMeta+Enter");
	await expect(page.getByTestId("queue-item")).toHaveCount(2);

	await strip.click();
	await expect(strip).toBeHidden();
	await expect(input).toHaveValue("first queued edit\n\nsecond queued edit");

	await page.getByTestId("chat-abort").click();
	await expect(page.getByTestId("chat-abort")).toBeHidden({ timeout: 60_000 });
	await expect(users).toHaveCount(3);
});
