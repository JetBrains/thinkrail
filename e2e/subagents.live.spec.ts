import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForDone } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): drives a REAL pi agent — and, through it, real delegated
// child sessions (pi-delegation + pi-subagents, embedded by the host). Delegates to the seeded `echo`
// personal definition (fixtures/agents.ts), not a builtin: deterministic, near-free children.
//
// Covers the stage-4/5 surface end to end: foreground parallel fan-out (two Agent calls in one message
// = two children truly concurrent, paced by the core's semaphore), the live AgentCard (collapsed stock
// ToolCard whose header line carries role + counters), the expanded body's report fold + transcript
// link, the read-only child transcript dialog (subagent.getTranscript), and the background path —
// whose terminal signal is the `subagent-completion` custom message crossing the LIVE WS event stream
// (task-spec open question #1: hydration already carried customs; this pins the live path).

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

	// Two primary Agent cards — delegation never folds into an activity group.
	const cards = page.locator(agentCards);
	await expect(cards).toHaveCount(2, { timeout: 180_000 });
	await expect(cards.first()).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await expect(cards.nth(1)).toHaveAttribute("data-status", "done", { timeout: 180_000 });
	await waitForDone(page, 120_000);

	// The collapsed header IS the live line — terminal here, so role + counters (e.g. "1 turn").
	const header = cards.first().getByTestId("tool-card-toggle");
	await expect(header).toContainText("echo");
	await expect(header).toContainText("turn");

	// Expand → the registered body (DefaultToolRenderer has no such hook), report fold, transcript.
	await header.click();
	const body = cards.first().getByTestId("tool-agent");
	await expect(body).toBeVisible();
	await body.getByTestId("agent-report-toggle").click();
	// Card order follows the assistant's tool-call order, which the model doesn't guarantee — either
	// child's marker proves the report text landed.
	await expect(body.getByTestId("agent-report")).toContainText(/(ALPHA|BRAVO)-MARKER/);

	await body.getByTestId("agent-open-transcript").click();
	const dialog = page.getByTestId("subagent-transcript-dialog");
	await expect(dialog).toBeVisible();
	// The child's own transcript, rendered with the chat primitives: its task prompt (a user turn)
	// and its reply (an assistant turn).
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

	// The tool resolves immediately with the background ack (the card freezes there by design —
	// pi drops onUpdate once the tool settles; the completion card below is the terminal signal).
	const card = page.locator(agentCards).first();
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 180_000 });

	// The child finishing injects a `subagent-completion` custom message (deliverAs followUp,
	// triggerTurn) — it must cross the live WS stream and render as its own compact card.
	const completion = page.getByTestId("subagent-completion");
	await expect(completion).toBeVisible({ timeout: 180_000 });
	await expect(completion).toHaveAttribute("data-status", "completed");
	await expect(completion).toContainText("echo finished");

	// The bounded report rides the message; the fold reveals it in place.
	await completion.getByTestId("subagent-completion-report-toggle").click();
	await expect(completion.getByTestId("subagent-completion-report")).toContainText(
		"CHARLIE-MARKER",
	);

	// And the completion card links the same read-only transcript view.
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
