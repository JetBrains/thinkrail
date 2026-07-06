import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): these drive a REAL pi agent — the only way to exercise the
// host-owned `ask_user_question` tool end to end, since the questionnaire is rendered from a real tool
// call (there is no fake agent). They prove the whole inline path: the agent calls the tool → its
// `execute` BLOCKS → our `AskUserQuestionCard` renders the questionnaire inline → the user answers/skips →
// the reply (`session.answerQuestion`) resolves the blocked tool. The card's pure logic (parse/derive/
// envelope/validation) is unit-tested separately (AskUserQuestionCard.test.ts, askUserQuestion.test.ts);
// the blocked-tool hydration shape in chat/hydrate.test.ts. Prompts steer the model to a specific question
// shape; assertions stay structural (data-testid / data-tone / data-selected) so they tolerate the exact
// wording the model chooses.

/** Reset state, open the fixture project, create a workspace + chat, and send `prompt`. */
async function ask(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

/** The interactive (pending) questionnaire card — visible while the tool call blocks on our answer. */
function activeCard(page: Page): Locator {
	return page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
}

/** The resolved record after a submitted answer. */
function answeredRecord(page: Page): Locator {
	return page.locator('[data-testid="ask-user-question"][data-tone="answered"]').first();
}

const ONLY_TOOL = "Call no other tool, and do nothing else besides asking.";

test("single-select: Submit is gated, an answer resolves the tool, the record renders", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE single-select question (multiSelect false) offering 3 short options with descriptions and no previews. ${ONLY_TOOL} After I answer, reply with one short sentence.`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// Submit is disabled until something is chosen (scenario "nothing selected"), Skip is always available.
	await expect(card.getByTestId("ask-submit")).toBeDisabled();
	await expect(card.getByTestId("ask-skip")).toBeEnabled();

	// Pick the first option → Submit enables. (The active card only renders once the args are final — the
	// composing placeholder has no option rows — so these clicks are inherently post-stream.)
	await card.getByTestId("ask-option").first().click();
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(1);
	await expect(card.getByTestId("ask-submit")).toBeEnabled();

	await card.getByTestId("ask-submit").click();

	// The record marks EXACTLY the chosen row selected (every option renders in the record, so a plain
	// text-contains assertion would pass vacuously) — and it's the first row, the one we clicked.
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	const chosen = record.locator('[data-testid="ask-record-option"][data-selected="true"]');
	await expect(chosen).toHaveCount(1);
	await expect(record.locator('[data-testid="ask-record-option"]').first()).toHaveAttribute(
		"data-selected",
		"true",
	);

	// And the agent actually consumed the answer: its round runs to completion ("✓ Done" closes the turn).
	await expect(
		page
			.locator('[data-testid="chat-message"][data-role="system"]')
			.filter({ hasText: "✓ Done" })
			.first(),
	).toBeVisible({ timeout: 60_000 });
});

test("multi-select: several options can be checked and submitted", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE question with multiSelect set to true and 4 short options. ${ONLY_TOOL}`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	const options = card.getByTestId("ask-option");
	await options.nth(0).click();
	await options.nth(1).click();
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(2);

	await card.getByTestId("ask-submit").click();
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	// Both checked options — and only those — round-trip into the record.
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
});

test("multi-select: the free-text row is mandatory and additive — checks + typed text round-trip", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE question with multiSelect set to true and 3 short options. ${ONLY_TOOL}`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// Issue #50: the "Other" free-text option must be offered on EVERY question — multi-select no
	// longer suppresses it. It renders as a native option row with its own checkbox.
	const custom = card.getByTestId("ask-custom");
	await expect(custom).toBeVisible();
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");

	// Check two options AND type a custom answer — typing checks the "Other" row (native checkbox) and
	// must not clear the other checks (additive, not exclusive).
	const options = card.getByTestId("ask-option");
	await options.nth(0).click();
	await options.nth(1).click();
	await custom.fill("my-extra-e2e-answer");
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "true");
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(2);

	await card.getByTestId("ask-submit").click();
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	// Both checked options round-trip into the record…
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
	// …and the record echoes the additional typed answer.
	await expect(record).toContainText("my-extra-e2e-answer");
});

test("freeform: a typed answer via 'Type your own answer' resolves the tool", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE single-select question with 2 short options and no previews. ${ONLY_TOOL}`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// Every question offers the free-text row; on single-select it is exclusive with the radio pick.
	const custom = card.getByTestId("ask-custom");
	await expect(custom).toBeVisible();
	await custom.fill("my-own-e2e-answer");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();
	await card.getByTestId("ask-submit").click();

	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	await expect(record).toContainText("my-own-e2e-answer"); // the record echoes the freeform answer
});

test("skip: declining resolves the tool as a skipped record", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(120_000);
	await ask(page, `Call the ask_user_question tool with one short question. ${ONLY_TOOL}`);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	await card.getByTestId("ask-skip").click();

	const skipped = page.locator('[data-testid="ask-user-question"][data-tone="skipped"]').first();
	await expect(skipped).toBeVisible({ timeout: 30_000 });
	await expect(skipped).toContainText("skipped");
});

test("multi-question: tab through, review, and submit a batch", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(180_000);
	await ask(
		page,
		`Call the ask_user_question tool ONCE with EXACTLY TWO questions, both single-select with 2 short options each and no previews. ${ONLY_TOOL}`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// Two questions + a synthetic "Review & submit" tab.
	const tabs = card.getByTestId("ask-tab");
	await expect(tabs).toHaveCount(3);

	// Answer each question tab (all but the last "Review & submit" chip) by picking its first option.
	for (let i = 0; i < 2; i++) {
		await tabs.nth(i).click();
		await card.getByTestId("ask-option").first().click();
	}
	// Every question answered → both tab chips flip to their "answered" marker.
	await expect(card.locator('[data-testid="ask-tab"][data-answered="true"]')).toHaveCount(2);

	// Review, then submit the batch.
	await tabs.nth(2).click();
	await card.getByTestId("ask-submit").click();
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	// One selected row per question — the whole batch round-tripped.
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
});

test("the blocked card survives closing and reopening the chat", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with one single-select question and 2 options. ${ONLY_TOOL}`,
	);

	const before = activeCard(page);
	// The active card appears only at message end, i.e. once the blocked tool call is durably in the
	// transcript — so the reopen below deterministically exercises the hydration path.
	await expect(before).toBeVisible({ timeout: 90_000 });
	await before.getByTestId("ask-option").first().click();
	await expect(before.getByTestId("ask-submit")).toBeEnabled({ timeout: 30_000 });

	// Close the chat tab — the session/runtime stay alive (the tool is still blocking on the host).
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);

	// Reopen from chat history → the still-pending questionnaire re-renders, ready to answer.
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });

	await card.getByTestId("ask-option").first().click();
	await card.getByTestId("ask-submit").click();
	await expect(answeredRecord(page)).toBeVisible({ timeout: 60_000 });
});
