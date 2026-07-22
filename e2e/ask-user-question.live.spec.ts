import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

// Tagged @agent (see agent.live.spec.ts): these drive a REAL pi agent — the only way to exercise the
// host-owned `ask_user_question` tool end to end, since the questionnaire is rendered from a real tool
// call (there is no fake agent). They prove the whole inline path under the ack + terminate design: the
// agent calls the tool → the tool acks and ENDS THE TURN (nothing blocks; the transcript stays valid
// across restarts) → our `AskUserQuestionCard` renders the awaiting questionnaire inline → the user
// answers/skips → the reply (`session.answerQuestion`) is injected as an `ask-user-answers` message that
// starts the next turn, and the card flips to its resolved record. The card's pure logic (parse/derive/
// envelope/validation/lifecycle) is unit-tested separately (AskUserQuestionCard.test.ts, askState.test.ts,
// askUserQuestion.test.ts); the hydration shape in chat/hydrate.test.ts. Prompts steer the model to a
// specific question shape; assertions stay structural (data-testid / data-tone / data-selected) so they
// tolerate the exact wording the model chooses.

/** Reset state, open the fixture project, create a workspace + chat, and send `prompt`. */
async function ask(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

/** The interactive (awaiting) questionnaire card — visible until it's answered or superseded. */
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

test("recommended option: its rationale is shown inline (no interaction needed)", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE single-select question (multiSelect false) offering 3 short options with descriptions and no previews. RECOMMEND one option: make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to a short sentence explaining why. ${ONLY_TOOL}`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// The recommended option's rationale is rendered inline — visible up front, no click, no popover.
	const reason = card.getByTestId("ask-recommended-reason").first();
	await expect(reason).toBeVisible();
	await expect(reason).toContainText("Why:");
	await expect(reason).not.toBeEmpty();

	// And merely surfacing the rationale must not have selected anything.
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(0);
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
	// …and the record echoes the additional typed answer, announced as selected to assistive tech.
	await expect(record).toContainText("my-extra-e2e-answer");
	await expect(
		record.getByTestId("ask-record-custom").getByTestId("ask-selection-status"),
	).toHaveText("Selected custom answer:");
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

test("multi-question: Next reaches review before submitting the batch", { tag: "@agent" }, async ({
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

	// Follow the sequential path: every real question — including the final one — advances with Next.
	// Capture the agent-authored text so the review can be checked against the exact questions/options.
	const questionTexts: string[] = [];
	const optionLabels: string[][] = [];
	for (let i = 0; i < 2; i++) {
		await expect(tabs.nth(i)).toHaveAttribute("data-active", "true");
		questionTexts.push((await card.getByTestId("ask-question-text").innerText()).trim());
		optionLabels.push(
			(await card.getByTestId("ask-option-label").allTextContents()).map((label) => label.trim()),
		);
		await card.getByTestId("ask-option").first().click();
		await expect(card.getByTestId("ask-submit")).toHaveCount(0);
		await card.getByTestId("ask-continue").click();
	}

	// Final-question Next must activate review rather than submitting directly.
	await expect(tabs.nth(2)).toHaveAttribute("data-active", "true");
	await expect(card).toContainText("Review your answers");
	await expect(card.getByTestId("ask-continue")).toHaveCount(0);
	await expect(card.getByTestId("ask-submit")).toBeEnabled();
	// Each review item carries the full original question, every option, and the selected answer.
	const reviewItems = card.getByTestId("ask-review-item");
	await expect(reviewItems).toHaveCount(2);
	for (let i = 0; i < 2; i++) {
		const item = reviewItems.nth(i);
		await expect(item.getByTestId("ask-review-question")).toHaveText(questionTexts[i] ?? "");
		const reviewOptions = item.getByTestId("ask-review-option");
		const labels = optionLabels[i] ?? [];
		await expect(reviewOptions).toHaveCount(labels.length);
		for (let j = 0; j < labels.length; j++) {
			const option = reviewOptions.nth(j);
			await expect(option).toContainText(labels[j] ?? "");
			await expect(option.getByTestId("ask-selection-status")).toHaveText(
				j === 0 ? "Selected:" : "Not selected:",
			);
		}
		await expect(
			item.locator('[data-testid="ask-review-option"][data-selected="true"]'),
		).toContainText(labels[0] ?? "");
	}
	// Every question answered → both question chips carry their answered marker.
	await expect(card.locator('[data-testid="ask-tab"][data-answered="true"]')).toHaveCount(2);

	await card.getByTestId("ask-submit").click();
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	// One selected row per question — the whole batch round-tripped.
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
});

test("typing a message instead of answering supersedes the questionnaire", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with one single-select question and 2 options. ${ONLY_TOOL} If I answer in chat instead, reply with one short sentence.`,
	);
	await expect(activeCard(page)).toBeVisible({ timeout: 90_000 });

	// Reply in chat instead of using the card — the user's own words are the answer now.
	await page.getByTestId("chat-input").fill("Just pick whichever option you prefer — go ahead.");
	await page.getByTestId("chat-send").click();

	// The card flips to its terminal superseded record (no longer answerable)…
	await expect(
		page.locator('[data-testid="ask-user-question"][data-tone="superseded"]').first(),
	).toBeVisible({ timeout: 30_000 });
	await expect(activeCard(page)).toHaveCount(0);
});

test("the awaiting card survives a reload (single-chat re-hydration)", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with one single-select question and 2 options. ${ONLY_TOOL}`,
	);

	const before = activeCard(page);
	// The active card appears only at message end, i.e. once the tool call is durably in the transcript —
	// so the reload below deterministically exercises the hydration path (the same path a host restart
	// takes: the awaiting state is pure transcript, nothing pends in memory).
	await expect(before).toBeVisible({ timeout: 90_000 });
	await before.getByTestId("ask-option").first().click();
	await expect(before.getByTestId("ask-submit")).toBeEnabled({ timeout: 30_000 });

	// The chat tab is non-closable (single-chat view rule), so exercise the same transcript-hydration
	// path via a reload: the session stays live on the host and the one chat auto-restores on activate.
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(chatTabs).toHaveCount(1, { timeout: 30_000 });
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });

	await card.getByTestId("ask-option").first().click();
	await card.getByTestId("ask-submit").click();
	await expect(answeredRecord(page)).toBeVisible({ timeout: 60_000 });
});
