import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";

async function ask(page: Page, prompt: string): Promise<void> {
	await openWorkspaceChat(page);
	await page.getByTestId("chat-input").fill(prompt);
	await page.getByTestId("chat-send").click();
}

function activeCard(page: Page): Locator {
	return page.locator('[data-testid="ask-user-question"][data-tone="active"]').first();
}

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

	const options = card.getByTestId("ask-option");
	await expect(options.first()).toBeFocused();
	await expect(card.getByTestId("ask-shortcuts")).toContainText("↑↓ move");
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Enter confirm");
	await expect(card.getByTestId("ask-shortcuts")).toContainText("Tab actions");

	await expect(card.getByTestId("ask-submit")).toBeDisabled();
	await expect(card.getByTestId("ask-skip")).toBeEnabled();

	await page.keyboard.press("ArrowDown");
	await expect(options.nth(1)).toBeFocused();
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();

	await page.keyboard.press("End");
	await expect(card.getByTestId("ask-custom")).toBeFocused();
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await page.keyboard.press("ArrowUp");
	await expect(options.last()).toBeFocused();
	await expect(options.last()).toHaveAttribute("data-selected", "true");
	await expect(card.getByTestId("ask-custom-row")).toHaveAttribute("data-selected", "false");
	await expect(card.getByTestId("ask-submit")).toBeEnabled();

	await page.keyboard.press("Home");
	await expect(options.first()).toHaveAttribute("data-selected", "true");
	await page.keyboard.press("ArrowDown");
	await expect(options.nth(1)).toBeFocused();
	await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
	await page.keyboard.press("Enter");

	await expect(page.getByTestId("chat-input")).toBeFocused();

	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	const chosen = record.locator('[data-testid="ask-record-option"][data-selected="true"]');
	await expect(chosen).toHaveCount(1);
	await expect(record.locator('[data-testid="ask-record-option"]').nth(1)).toHaveAttribute(
		"data-selected",
		"true",
	);

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

	const draft = page.getByTestId("chat-input");
	await draft.fill("keep this in-progress draft");
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 90_000 });
	await expect(draft).toBeFocused();
	await expect(draft).toHaveValue("keep this in-progress draft");

	const reason = card.getByTestId("ask-recommended-reason").first();
	await expect(reason).toBeVisible();
	await expect(reason).toContainText("Why:");
	await expect(reason).not.toBeEmpty();

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

	await page.keyboard.press("Enter");
	await expect(card.getByTestId("ask-needs-choice")).toBeVisible();
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(0);
	await expect(card).toBeVisible();

	await expect(card.getByTestId("ask-note-toggle")).toHaveCount(0);

	await page.keyboard.press("Space");
	await expect(card.getByTestId("ask-note-toggle")).toHaveCount(1);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Space");
	await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(2);
	await expect(card.getByTestId("ask-needs-choice")).toHaveCount(0);

	const labels = (await card.getByTestId("ask-option-label").allTextContents()).map((label) =>
		label.trim(),
	);
	const noteToggles = card.getByTestId("ask-note-toggle");
	await expect(noteToggles).toHaveCount(2);
	await expect(noteToggles.nth(0)).toHaveAccessibleName(`Add note for ${labels[0]}`);
	await expect(noteToggles.nth(1)).toHaveAccessibleName(`Add note for ${labels[1]}`);

	await noteToggles.nth(0).click();
	const note = card.getByTestId("ask-note");
	await expect(note).toBeFocused();
	await page.keyboard.type("e2e-note-alpha");
	await page.keyboard.press("Enter");
	await expect(note).toHaveCount(0);
	await expect(noteToggles.nth(0)).toContainText("Edit note");

	await noteToggles.nth(1).click();
	await expect(card.getByTestId("ask-note")).toBeFocused();
	await page.keyboard.type("e2e-note-beta");
	await page.keyboard.press("Enter");
	await expect(options.nth(1)).toBeFocused();

	await page.keyboard.press("Enter");
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
	await expect(record).toContainText(`${labels[0]}: e2e-note-alpha`);
	await expect(record).toContainText(`${labels[1]}: e2e-note-beta`);
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

	const custom = card.getByTestId("ask-custom");
	const customRow = card.getByTestId("ask-custom-row");
	await expect(custom).toBeVisible();
	await expect(customRow).toHaveAttribute("data-selected", "false");

	await customRow.getByText("Other", { exact: true }).click();
	await expect(custom).toBeFocused();
	await expect(customRow).toHaveAttribute("data-selected", "false");

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
	await expect(
		record.locator('[data-testid="ask-record-option"][data-selected="true"]'),
	).toHaveCount(2);
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
	await expect(record).toContainText("my-own-e2e-answer");
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

	const tabs = card.getByTestId("ask-tab");
	await expect(tabs).toHaveCount(3);

	const panel = card.getByRole("tabpanel");
	await expect(tabs.nth(0)).toHaveAttribute(
		"aria-controls",
		(await panel.getAttribute("id")) ?? "",
	);
	await expect(panel).toHaveAttribute(
		"aria-labelledby",
		(await tabs.nth(0).getAttribute("id")) ?? "",
	);

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

	await expect(card.getByTestId("ask-submit")).toHaveCount(0);
	await card.getByTestId("ask-continue").click();
	await expect(tabs.nth(1)).toHaveAttribute("data-active", "true");
	questionTexts.push((await card.getByTestId("ask-question-text").innerText()).trim());
	optionLabels.push(
		(await card.getByTestId("ask-option-label").allTextContents()).map((label) => label.trim()),
	);
	await expect(card.getByTestId("ask-option").first()).toBeFocused();

	await page.keyboard.press("ArrowLeft");
	await expect(tabs.nth(0)).toHaveAttribute("data-active", "true");
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(tabs.nth(1)).toHaveAttribute("data-active", "true");
	await expect(card.getByTestId("ask-option").first()).toBeFocused();

	await page.keyboard.press("Enter");
	await expect(tabs.nth(2)).toHaveAttribute("data-active", "true");
	await expect(card).toContainText("Review your answers");
	await expect(card.getByTestId("ask-continue")).toHaveCount(0);
	await expect(card.getByTestId("ask-submit")).toBeEnabled();
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
	await expect(card.locator('[data-testid="ask-tab"][data-answered="true"]')).toHaveCount(2);
	await expect(card.getByTestId("ask-submit")).toBeFocused();
	await page.keyboard.press("Enter");
	const record = answeredRecord(page);
	await expect(record).toBeVisible({ timeout: 60_000 });
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

	await page.getByTestId("chat-input").fill("Just pick whichever option you prefer — go ahead.");
	await page.getByTestId("chat-send").click();

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
	await expect(before).toBeVisible({ timeout: 90_000 });
	await before.getByTestId("ask-option").first().click();
	await expect(before.getByTestId("ask-submit")).toBeEnabled({ timeout: 30_000 });

	const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTabs.first().getByTestId("editor-tab-close").click();
	await expect(chatTabs).toHaveCount(0);

	await page.getByTestId("chat-history").first().click();
	await page.getByTestId("closed-chat-item").first().click();
	await expect(chatTabs).toHaveCount(1);
	const card = activeCard(page);
	await expect(card).toBeVisible({ timeout: 30_000 });
	await expect(card.getByTestId("ask-option").first()).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(answeredRecord(page)).toBeVisible({ timeout: 60_000 });
});
