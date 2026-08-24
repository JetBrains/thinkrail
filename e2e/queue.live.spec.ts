import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

const COUNT_PROMPT =
	"Count from 1 to 60, one number per line. No other text, no tools, just the numbers.";

test("queueing: pending strip + canonical order; per-row edit/remove; interrupt aborts and sends now", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
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
	await expect(input).toHaveAttribute("placeholder", /Enter steers at the next step/, {
		timeout: 60_000,
	});

	await input.fill("Now reply with exactly the single word: QUEUEDOK");
	await input.press("ControlOrMeta+Enter");

	await expect(input).toHaveValue("");
	await expect(strip).toBeVisible();
	await expect(page.getByTestId("queue-item")).toContainText("QUEUEDOK");
	await expect(page.getByTestId("queue-item")).toHaveAttribute("data-kind", "followUp");
	await expect(page.getByTestId("send-menu")).toBeVisible();
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

	await input.fill(
		"Count from 1 to 200, one number per line. No other text, no tools, just the numbers.",
	);
	await input.press("Enter");
	await expect(users).toHaveCount(3, { timeout: 60_000 });
	await expect(input).toHaveAttribute("placeholder", /Enter steers at the next step/, {
		timeout: 60_000,
	});

	await input.fill("first queued edit");
	await input.press("ControlOrMeta+Enter");
	await input.fill("second queued edit");
	await input.press("ControlOrMeta+Enter");
	await expect(page.getByTestId("queue-item")).toHaveCount(2);

	await page
		.locator('[data-testid="queue-item"][data-index="0"]')
		.getByTestId("queue-item-remove")
		.click();
	await expect(page.getByTestId("queue-item")).toHaveCount(1);
	await expect(page.getByTestId("queue-item")).toContainText("second queued edit");

	await page.getByTestId("queue-item-edit").click();
	await expect(strip).toBeHidden();
	await expect(input).toHaveValue("second queued edit");

	await input.fill("Now reply with exactly the single word: INTERRUPTOK");
	await input.press("ControlOrMeta+Shift+Enter");
	await expect(users).toHaveCount(4, { timeout: 60_000 });
	await expect(assistants.last()).toContainText("INTERRUPTOK", { timeout: 120_000 });
	await expect(page.getByTestId("chat-abort")).toBeHidden({ timeout: 60_000 });
});
