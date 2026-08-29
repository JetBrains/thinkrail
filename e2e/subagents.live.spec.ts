import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

const agentCards = '[data-testid="tool-card"][data-tool="Agent"]';

test("foreground parallel fan-out: live Agent cards, report fold, child transcript dialog", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call the Agent tool TWICE in this single reply (two tool calls in one message): both with subagent_type "echo", one with task "Reply with exactly: ALPHA-MARKER", the other with task "Reply with exactly: BRAVO-MARKER". After both return, reply with the single word done.',
		);
	await page.getByTestId("chat-send").click();

	const cards = page.locator(agentCards);
	await expect(cards).toHaveCount(2, { timeout: 180_000 });
	await expect(cards.first()).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await expect(cards.nth(1)).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await waitForDone(page, 120_000);

	const header = cards.first().getByTestId("tool-card-toggle");
	await expect(header).toContainText("echo");
	await expect(header).toContainText("turn");

	await header.click();
	const body = cards.first().getByTestId("tool-agent");
	await expect(body).toBeVisible();
	await body.getByTestId("agent-report-toggle").click();
	await expect(body.getByTestId("agent-report")).toContainText(/(ALPHA|BRAVO)-MARKER/);

	await body.getByTestId("agent-open-transcript").click();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	const transcript = dialog.getByTestId("subagent-transcript");
	await expect(transcript.locator('[data-testid="chat-message"][data-role="user"]')).toContainText(
		/Reply with exactly: (ALPHA|BRAVO)-MARKER/,
		{ timeout: 15_000 },
	);
	await expect(
		transcript.locator('[data-testid="chat-message"][data-role="assistant"]').last(),
	).toContainText(/(ALPHA|BRAVO)-MARKER/);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
});

test("background run: completion card arrives live, with report + transcript", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	await openWorkspaceChat(page);
	await page
		.getByTestId("chat-input")
		.fill(
			'Call the Agent tool once with subagent_type "echo", task "Reply with exactly: CHARLIE-MARKER", and run_in_background set to true. Then reply with the single word started. Do NOT call get_subagent_result — the result arrives on its own.',
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator(agentCards).first();
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 180_000 });

	const completion = page.getByTestId("subagent-completion");
	await expect(completion).toBeVisible({ timeout: 180_000 });
	await expect(completion).toHaveAttribute("data-status", "completed");
	await expect(completion).toContainText("echo finished");

	await completion.getByTestId("subagent-completion-report-toggle").click();
	await expect(completion.getByTestId("subagent-completion-report")).toContainText(
		"CHARLIE-MARKER",
	);

	await completion.getByTestId("subagent-completion-transcript").click();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	await expect(
		dialog
			.getByTestId("subagent-transcript")
			.locator('[data-testid="chat-message"][data-role="assistant"]')
			.last(),
	).toContainText("CHARLIE-MARKER", { timeout: 15_000 });
});
