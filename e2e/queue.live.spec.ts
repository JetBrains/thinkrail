import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

const COUNT_PROMPT =
	"Count from 1 to 60, one number per line. No other text, no tools, just the numbers.";

test("queueing: pending strip + canonical order; per-row edit/remove; interrupt aborts and sends now", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chatTab).toHaveCount(1);
	const sessionId = await chatTab.getAttribute("data-session-id");
	if (!sessionId) throw new Error("Queue test chat is missing its session id");

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
	await expect(users.last()).toContainText("QUEUEDOK");
	await expect(assistants.first()).toContainText("60");

	const wire = await E2eWire.connect();
	const transcript = await wire
		.request("session.getMessages", { sessionId, workspaceId: workspace.id })
		.finally(() => wire.close());
	const firstAssistant = transcript.messages.findIndex((message) => message.role === "assistant");
	const queuedUser = transcript.messages.findIndex(
		(message) => message.role === "user" && JSON.stringify(message.content).includes("QUEUEDOK"),
	);
	expect(firstAssistant).toBeGreaterThan(0);
	expect(queuedUser).toBeGreaterThan(firstAssistant);

	await input.fill(
		"Count from 1 to 200, one number per line. No other text, no tools, just the numbers.",
	);
	await input.press("Enter");
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
	await expect(users.last()).toContainText("INTERRUPTOK", { timeout: 60_000 });
	await expect(assistants.last()).toContainText("INTERRUPTOK", { timeout: 120_000 });
	await expect(page.getByTestId("chat-abort")).toBeHidden({ timeout: 60_000 });
});
