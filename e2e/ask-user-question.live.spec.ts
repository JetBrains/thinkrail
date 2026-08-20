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

test("single-select: focus, roving keys, and Enter resolve the tool", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with EXACTLY ONE single-select question (multiSelect false) offering 3 short options with descriptions and no previews. ${ONLY_TOOL} After I answer, reply with one short sentence.`,
	);

	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });

	// The completed card claims keyboard attention once and teaches the local key model in its footer.
	const options = card.getByTestId("ask-option");
	await expect(options.first()).toBeFocused();
	await expect(card.getByTestId("ask-shortcuts")).toContainText("↑↓ move");
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Enter confirm");
	// Nothing is picked yet, so there is no note control to promise — the legend offers "Tab actions".
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Tab actions");

	// Submit is disabled until something is chosen (scenario "nothing selected"), Skip is always available.
	await expect(card.getByTestId("ask-submit")).toBeDisabled();
	await expect(card.getByTestId("ask-skip")).toBeEnabled();

	// ArrowDown moves the cursor without selecting; Space selects; Enter confirms/submits in place.
	await page.keyboard.press("ArrowDown");
	await expect(options.nth(1)).toBeFocused();
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(0);
	await page.keyboard.press("Space");
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();

	// Navigating THROUGH Other must not spend the answer: End lands in its input ready to type, but it is
	// typed text — never focus — that makes Other the pick, so the chosen row survives the round trip.
	await page.keyboard.press("End");
	await expect(card.getByTestId("ask-custom")).toBeFocused();
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await page.keyboard.press("ArrowUp");
	await expect(options.last()).toBeFocused();
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();

	// Back onto the chosen row (Home, then one step down — option count is agent-authored) and confirm.
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowDown");
	await expect(options.nth(1)).toBeFocused();
	await page.keyboard.press("Enter");

	// Answering unmounts the row that held focus, so the composer takes it back — the next keystroke is a
	// message, not a keypress into `<body>`.
	await expect(page.getByTestId("chat-input")).toBeFocused();

	// The record marks EXACTLY the chosen row selected (every option renders in the record, so a plain
	// text-contains assertion would pass vacuously) — and it's the second row, selected by keyboard.
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	const chosen = record.locator('[data-testid="ask-record-option"][data-selected="true"]');
	await expect(chosen).toHaveCount(1);
	await expect(record.locator('[data-testid="ask-record-option"]').nth(1)).toHaveAttribute(
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

	// A real draft is active typing: the arriving card should reveal itself but must not steal focus.
	const draft = page.getByTestId("chat-input");
	await draft.fill("keep this in-progress draft");
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(draft).toBeFocused();
	await expect(draft).toHaveValue("keep this in-progress draft");

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
	await expect(options.first()).toBeFocused();

	// Confirming an empty multi-select set has nothing to confirm — the card says so rather than
	// swallowing the keystroke, and stays open with the set untouched.
	await page.keyboard.press("Enter");
	await expect(card.getByTestId("ask-needs-choice")).toBeVisible();
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(0);
	await expect(card).toBeVisible();

	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Space");
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(2);
	await expect(card.getByTestId("ask-needs-choice")).toHaveCount(0);

	// Multi-select Enter confirms the built set; it does not toggle the cursor again.
	await page.keyboard.press("Enter");
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
	const customRow = card.getByTestId("ask-custom-row");
	await expect(custom).toBeVisible();
	await expect(customRow).toHaveAttribute("data-selected", "false");

	// Clicking the row's own chrome must put the caret in the field, NOT flip the checkbox. `<button>` is a
	// labelable element, so without the explicit `htmlFor` the label's implicit control is the multi-select
	// include/exclude toggle sitting above the input — tapping "Other" would check an empty row and never
	// focus anything, which on touch is the only way in.
	await customRow.getByText("Other", { exact: true }).click();
	await expect(custom).toBeFocused();
	await expect(customRow).toHaveAttribute("data-selected", "false");

	// Check two options AND type a custom answer — typing checks the "Other" row (native checkbox) and
	// must not clear the other checks (additive, not exclusive).
	const options = card.getByTestId("ask-option");
	await options.nth(0).click();
	await options.nth(1).click();
	await page.keyboard.press("End");
	await expect(custom).toBeFocused();
	await page.keyboard.type("my-extra-e2e-answer");
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

	// Every question offers the free-text row; Up from the first authored choice wraps directly into its
	// input, ready to type. Typing — not the focus that got there — is what makes it the answer. Enter
	// then confirms the non-empty custom answer in place.
	const custom = card.getByTestId("ask-custom");
	await expect(custom).toBeVisible();
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(custom).toBeFocused();
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");
	await page.keyboard.type("my-own-e2e-answer");
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "true");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();
	await page.keyboard.press("Enter");

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
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Shift+Esc skip");

	await page.keyboard.press("Shift+Escape");

	// Declining is a reply too — the card hands focus back rather than stranding it on `<body>`.
	await expect(page.getByTestId("chat-input")).toBeFocused();

	const skipped = page.locator('[data-testid="ask-user-question"][data-tone="skipped"]').first();
	await expect(skipped).toBeVisible({ timeout: 30_000 });
	await expect(skipped).toContainText("skipped");
});

test("multi-question: page arrows, Tab-to-note, and Enter reach review before submit", {
	tag: "@agent",
}, async ({ page }) => {
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

	// A real tablist: every chip controls the shared question panel, which the active chip labels.
	const panel = card.getByRole("tabpanel");
	await expect(tabs.nth(0)).toHaveAttribute(
		"aria-controls",
		(await panel.getAttribute("id")) ?? "",
	);
	await expect(panel).toHaveAttribute(
		"aria-labelledby",
		(await tabs.nth(0).getAttribute("id")) ?? "",
	);

	// Capture Q1, select its focused choice, then Tab to the explicit Add note control and press Enter.
	// Shift+Enter keeps a newline; Shift+Escape, Escape and Enter all finish the editor without losing
	// text and restore focus to the choice — and Shift+Escape stops there rather than skipping the card.
	const questionTexts: string[] = [];
	const optionLabels: string[][] = [];
	await expect(tabs.nth(0)).toHaveAttribute("data-active", "true");
	questionTexts.push((await card.getByTestId("ask-question-text").innerText()).trim());
	optionLabels.push(
		(await card.getByTestId("ask-option-label").allTextContents()).map((label) => label.trim()),
	);
	const firstChoice = card.getByTestId("ask-option").first();
	const noteToggle = card.getByTestId("ask-note-toggle");
	await expect(firstChoice).toBeFocused();
	await page.keyboard.press("Space");
	await page.keyboard.press("Tab");
	await expect(noteToggle).toBeFocused();
	await page.keyboard.press("Enter");
	let note = card.getByTestId("ask-note");
	await expect(note).toBeFocused();
	await page.keyboard.type("first line");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("second line");

	// Shift+Escape is the card's skip gesture, but an open editor consumes it first — closing the note,
	// never throwing away the questionnaire and the text being typed into it.
	await page.keyboard.press("Shift+Escape");
	await expect(note).toHaveCount(0);
	await expect(card).toBeVisible();
	await expect(firstChoice).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(noteToggle).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(note).toHaveValue("first line\nsecond line");

	await page.keyboard.press("Escape");
	await expect(firstChoice).toBeFocused();
	await expect(note).toHaveCount(0);
	await page.keyboard.press("Tab");
	await expect(noteToggle).toBeFocused();
	await page.keyboard.press("Enter");
	note = card.getByTestId("ask-note");
	await expect(note).toHaveValue("first line\nsecond line");
	await page.keyboard.press("Enter");
	await expect(firstChoice).toBeFocused();
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Tab note/actions");
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Shift+Esc skip");
	await expect(card.getByTestId("ask-shortcuts")).toContainText("←→ questions");

	// Keep the existing explicit Next path for Q1. Q2 receives focus automatically.
	await expect(card.getByTestId("ask-submit")).toHaveCount(0);
	await card.getByTestId("ask-continue").click();
	await expect(tabs.nth(1)).toHaveAttribute("data-active", "true");
	questionTexts.push((await card.getByTestId("ask-question-text").innerText()).trim());
	optionLabels.push(
		(await card.getByTestId("ask-option-label").allTextContents()).map((label) => label.trim()),
	);
	await expect(card.getByTestId("ask-option").first()).toBeFocused();

	// Left/Right moves between question pages without wrapping and focus follows each page.
	await page.keyboard.press("ArrowLeft");
	await expect(tabs.nth(0)).toHaveAttribute("data-active", "true");
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(tabs.nth(1)).toHaveAttribute("data-active", "true");
	await expect(card.getByTestId("ask-option").first()).toBeFocused();

	// Enter chooses the focused single-select option and confirms Q2 in one action, reaching review.
	await page.keyboard.press("Enter");
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
	// Every question answered → both question chips carry their answered marker. Review lands the keyboard
	// on the real Submit button, so Enter submits without another Tab traversal.
	await expect(card.locator('[data-testid="ask-tab"][data-answered="true"]')).toHaveCount(2);
	await expect(card.getByTestId("ask-submit")).toBeFocused();
	await page.keyboard.press("Enter");
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	// One selected row per question — the whole batch and the keyboard-authored note round-tripped.
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
	await expect(record).toContainText("Note: first line");
	await expect(record).toContainText("second line");
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

test("the awaiting card survives closing and reopening the chat", { tag: "@agent" }, async ({
	page,
}) => {
	test.setTimeout(150_000);
	await ask(
		page,
		`Call the ask_user_question tool with one single-select question and 2 options. ${ONLY_TOOL}`,
	);

	const before = activeCard(page);
	// The active card appears only at message end, i.e. once the tool call is durably in the transcript —
	// so the reopen below deterministically exercises the hydration path (the same path a host restart
	// takes: the awaiting state is pure transcript, nothing pends in memory).
	await expect(before).toBeVisible({ timeout: 90_000 });
	await before.getByTestId("ask-option").first().click();
	await expect(before.getByTestId("ask-submit")).toBeEnabled({ timeout: 30_000 });

	// Close the chat tab — the session stays live on the host; the questionnaire stays awaiting.
	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);

	// Reopen from chat history → the still-awaiting questionnaire re-renders, ready to answer.
	await page.getByTestId("chat-history").click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });
	// A deliberate reopen creates a fresh focus scope: the still-selected choice receives attention again.
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(answeredRecord(page)).toBeVisible({ timeout: 60_000 });
});
