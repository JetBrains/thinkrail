import { readFileSync, realpathSync, rmSync, utimesSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { ToolCall, ToolResponsePendingDetails } from "@thinkrail/contracts";
import type {
	AskUserQuestionArgs,
	AskUserQuestionOption,
	AskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question/core";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	openPersistedChat,
	pressPlatformShortcut,
} from "./fixtures/app";
import {
	clickTranscriptControl,
	moveMouseToChatViewport,
	nestedVerticalScrollSurfaces,
	readChatScrollGeometry,
	readChatViewportIntersection,
	waitForScrollStability,
} from "./fixtures/chatScroll";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_800_000_000;

function tallPreview(pageName: string): string {
	return Array.from(
		{ length: 24 },
		(_, index) =>
			`${pageName} detail ${index + 1}. This persisted preview is intentionally long enough to put the questionnaire footer on a later transcript viewport.`,
	).join("\n\n");
}

function optionsFor(pageName: string) {
	return [
		{ label: `${pageName} alpha`, description: "Use the first deterministic fixture choice." },
		{ label: `${pageName} beta`, description: "Use the second deterministic fixture choice." },
		{ label: `${pageName} gamma`, description: "Use the third deterministic fixture choice." },
	] satisfies AskUserQuestionOption[];
}

async function openPersistedChatAfterInput(page: Page, title: string): Promise<void> {
	await openPersistedChat(page, title);
	const chatTab = page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.filter({ hasText: title });
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await openPersistedChat(page, title);
}

async function selectOldestFirst(page: Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId("chat-order-oldest-first");
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
}

function seedQuestionnaire(
	name: string,
	toolCallId: string,
	args: AskUserQuestionArgs & ToolCall["arguments"],
) {
	const ack: ToolResponsePendingDetails = { kind: "ack" };
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name,
		messages: [
			{ role: "user", text: "Ask me these questions.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: toolCallId,
						name: "ask_user_question",
						arguments: args,
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId,
				toolName: "ask_user_question",
				content: [{ type: "text", text: "Questions shown to the user; awaiting an answer." }],
				details: ack,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	utimesSync(session.path, new Date(BASE_TS), new Date(BASE_TS));
	return session;
}

function seedPanedQuestionnaire(name: string, toolCallId: string) {
	const paned = (pageName: string) =>
		optionsFor(pageName).map((option, index) =>
			index === 0 ? { ...option, preview: `${pageName} alpha keeps the rollout staged.` } : option,
		);
	return seedQuestionnaire(name, toolCallId, {
		questions: [
			{
				question: "Which first-page rollout should we use?",
				header: "First page",
				options: paned("First"),
			},
			{
				question: "Which second-page rollout should we use?",
				header: "Second page",
				options: paned("Second"),
			},
		],
	});
}

function seedTallQuestionnaire(name: string, toolCallId: string) {
	return seedQuestionnaire(name, toolCallId, {
		questions: [
			{
				question: "Which first-page rollout should we use?",
				header: "First page",
				preview: tallPreview("First"),
				options: optionsFor("First"),
			},
			{
				question: "Which second-page rollout should we use?",
				header: "Second page",
				preview: tallPreview("Second"),
				options: optionsFor("Second"),
			},
		],
	});
}

async function wheelUntilChatElementIntersects(
	page: Page,
	chatScroll: Locator,
	target: Locator,
): Promise<void> {
	await moveMouseToChatViewport(page, chatScroll);
	for (let attempt = 0; attempt < 16; attempt += 1) {
		if ((await readChatViewportIntersection(target)).intersects) return;
		const before = await readChatScrollGeometry(chatScroll);
		await page.mouse.wheel(0, before.clientHeight * 0.75);
		await expect
			.poll(async () => {
				const after = await readChatScrollGeometry(chatScroll);
				return (
					(await readChatViewportIntersection(target)).intersects ||
					after.distanceFromStart > before.distanceFromStart
				);
			})
			.toBe(true);
	}
	await expect.poll(async () => (await readChatViewportIntersection(target)).intersects).toBe(true);
}

const KEYBOARD_ROLLOUT = {
	question: "Which keyboard rollout should we use?",
	header: "Rollout",
	options: [
		{ label: "Keyboard alpha", description: "Use the first fixture choice." },
		{ label: "Keyboard beta", description: "Use the second fixture choice." },
		{ label: "Keyboard gamma", description: "Use the third fixture choice." },
	],
} satisfies AskUserQuestionArgs["questions"][number];

const KEYBOARD_ROUND = {
	questions: [
		KEYBOARD_ROLLOUT,
		{
			question: "Which keyboard checks should run?",
			header: "Checks",
			multiSelect: true,
			options: [
				{ label: "Keyboard lint", description: "Run the linter." },
				{ label: "Keyboard types", description: "Run the type checker." },
				{ label: "Keyboard units", description: "Run the unit tests." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

test("the keyboard alone reaches every control and answers a two-page questionnaire", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("keyboard round", "ask-keyboard-round", KEYBOARD_ROUND);

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "keyboard round");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		const options = card.getByTestId("ask-option");
		const questionText = card.getByTestId("ask-question-text");
		await expect(options.first()).toBeFocused();

		await page.keyboard.press("ArrowDown");
		await expect(options.nth(1)).toBeFocused();
		await expect(options.nth(1)).toHaveAttribute("data-selected", "false");
		await page.keyboard.press("Enter");
		await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
		await expect(options.nth(1)).toBeFocused();
		await expect(questionText).toHaveText(KEYBOARD_ROLLOUT.question);

		await page.keyboard.press("Space");
		const note = card.getByTestId("ask-note");
		await expect(note).toBeFocused();
		await page.keyboard.type("Typed without a mouse.");
		await page.keyboard.press("Enter");
		const noteToggle = card.getByTestId("ask-note-toggle");
		await expect(noteToggle).toBeFocused();
		await expect(noteToggle).toContainText("Typed without a mouse.");
		await page.keyboard.press("Enter");
		await expect(note).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(noteToggle).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(options.nth(1)).toBeFocused();

		for (const target of ["ask-note-toggle", "ask-custom", "ask-skip", "ask-continue"]) {
			await page.keyboard.press("Tab");
			await expect(card.getByTestId(target)).toBeFocused();
		}
		await page.keyboard.press("ArrowUp");
		await expect(card.getByTestId("ask-custom")).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(card.getByTestId("ask-continue")).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(questionText).toHaveText("Which keyboard checks should run?");
		await expect(options.first()).toBeFocused();

		await page.keyboard.press("Enter");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(card.locator('[data-testid="ask-option"][data-selected="true"]')).toHaveCount(2);
		await expect(questionText).toHaveText("Which keyboard checks should run?");
		await page.keyboard.press("ArrowLeft");
		await expect(questionText).toHaveText(KEYBOARD_ROLLOUT.question);
		await page.keyboard.press("ArrowRight");
		await expect(questionText).toHaveText("Which keyboard checks should run?");

		await pressPlatformShortcut(page, "Enter");
		await expect(
			page.locator('[data-testid="ask-user-question"][data-tone="answered"]'),
		).toBeVisible();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a click hands the keyboard to the clicked option even where clicks do not focus buttons", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("click then keys", "ask-click-then-keys", {
		questions: [KEYBOARD_ROLLOUT],
	});

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "click then keys");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		const options = card.getByTestId("ask-option");
		await expect(options.first()).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(options.nth(1)).toBeFocused();

		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await options.nth(2).dispatchEvent("click");
		await expect(options.nth(2)).toBeFocused();
		await expect(options.nth(2)).toHaveAttribute("data-selected", "true");
		await page.keyboard.press("ArrowUp");
		await expect(options.nth(1)).toBeFocused();
		await expect(options.nth(2)).toHaveAttribute("data-selected", "true");
		await page.keyboard.press("Enter");
		await expect(options.nth(1)).toHaveAttribute("data-selected", "true");
		await expect(options.nth(2)).toHaveAttribute("data-selected", "false");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a persisted tall questionnaire reveals page changes and a restored page", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await openFixtureProject(page);

	const session = seedTallQuestionnaire("tall persisted questionnaire", "ask-tall-pages");

	try {
		await selectOldestFirst(page);
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "tall persisted questionnaire");

		const chatScroll = page.getByTestId("chat-scroll");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		await expect(card).toBeVisible();
		await expect(card.getByTestId("ask-question-text")).toHaveText(
			"Which first-page rollout should we use?",
		);

		const firstOption = card.getByTestId("ask-option").first();
		await expect(firstOption).toBeFocused();
		await expect(chatScroll).toHaveAttribute("data-follow-state", "following");
		await expect(page.getByTestId("scroll-to-bottom")).toHaveCount(0);
		await waitForScrollStability(chatScroll);
		await firstOption.click();
		await expect(firstOption).toHaveAttribute("data-selected", "true");
		const next = card.getByTestId("ask-continue");
		expect((await readChatViewportIntersection(next)).intersects).toBe(false);
		await wheelUntilChatElementIntersects(page, chatScroll, next);
		await expect.poll(async () => (await readChatViewportIntersection(next)).intersects).toBe(true);

		await next.click();
		const secondHeading = card.getByTestId("ask-question-text");
		await expect(secondHeading).toHaveText("Which second-page rollout should we use?");
		const secondFirstOption = card.getByTestId("ask-option").first();
		await expect(secondFirstOption).toBeFocused();
		await expect
			.poll(async () => ({
				heading: (await readChatViewportIntersection(secondHeading)).intersects,
				firstOption: (await readChatViewportIntersection(secondFirstOption)).intersects,
			}))
			.toEqual({ heading: true, firstOption: true });
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");

		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		await chatTabs.first().getByTestId("editor-tab-close").click();
		await expect(chatTabs).toHaveCount(0);
		await page.getByTestId("chat-history").first().click();
		await page
			.getByTestId("closed-chat-item")
			.filter({ hasText: "tall persisted questionnaire" })
			.click();
		await expect(chatTabs).toHaveCount(1);

		const reopenedCard = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		const reopenedHeading = reopenedCard.getByTestId("ask-question-text");
		const reopenedFirstOption = reopenedCard.getByTestId("ask-option").first();
		await expect(reopenedHeading).toHaveText("Which second-page rollout should we use?");
		await expect(reopenedFirstOption).toBeFocused();
		await expect
			.poll(async () => ({
				heading: (await readChatViewportIntersection(reopenedHeading)).intersects,
				firstOption: (await readChatViewportIntersection(reopenedFirstOption)).intersects,
			}))
			.toEqual({ heading: true, firstOption: true });

		await reopenedFirstOption.click();
		await page.setViewportSize({ width: 1280, height: 440 });
		await expect(reopenedCard.getByTestId("ask-continue")).toHaveCount(0);
		const submit = reopenedCard.getByTestId("ask-submit");
		await wheelUntilChatElementIntersects(page, chatScroll, submit);
		await expect(submit).toBeEnabled();

		expect(await nestedVerticalScrollSurfaces(reopenedCard)).toEqual([]);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a key pressed before a reopened questionnaire's first frame does not cancel its focus claim", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("early input questionnaire", "ask-early-input", {
		questions: [
			{
				question: "Which early rollout should we use?",
				header: "Early",
				options: [
					{ label: "Early alpha", description: "Use the first fixture choice." },
					{ label: "Early beta", description: "Use the second fixture choice." },
				],
			},
		],
	});
	type HeldFrames = Window & { releaseHeldFrames?: () => void };

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "early input questionnaire");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		await expect(card.getByTestId("ask-option").first()).toBeFocused();

		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		await chatTabs.first().getByTestId("editor-tab-close").click();
		await expect(chatTabs).toHaveCount(0);
		await page.getByTestId("chat-history").first().click();
		await page.evaluate(() => {
			const held: FrameRequestCallback[] = [];
			const request = window.requestAnimationFrame.bind(window);
			window.requestAnimationFrame = (callback) => held.push(callback);
			(window as HeldFrames).releaseHeldFrames = () => {
				window.requestAnimationFrame = request;
				for (const callback of held.splice(0)) request(callback);
			};
		});
		await page
			.getByTestId("closed-chat-item")
			.filter({ hasText: "early input questionnaire" })
			.click();
		await expect(card).toBeVisible();
		await page.keyboard.press("Shift");
		await page.evaluate(() => (window as HeldFrames).releaseHeldFrames?.());
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
	} finally {
		await page.evaluate(() => (window as HeldFrames).releaseHeldFrames?.()).catch(() => undefined);
		rmSync(session.path, { force: true });
	}
});

test("a questionnaire with more than four questions exposes every page and submits from the last", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("six-question round", "ask-six-questions", {
		questions: Array.from({ length: 6 }, (_, index) => ({
			question: `Which choice should question ${index + 1} use?`,
			header: `Q${index + 1}`,
			options: [
				{ label: `Choice ${index + 1}A`, description: "Use the first fixture choice." },
				{ label: `Choice ${index + 1}B`, description: "Use the second fixture choice." },
			],
		})),
	});

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "six-question round");

		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		await expect(card).toBeVisible();
		await expect(card.getByTestId("ask-tab")).toHaveCount(6);
		await card.getByTestId("ask-tab").nth(5).click();
		await expect(card.getByTestId("ask-question-text")).toHaveText(
			"Which choice should question 6 use?",
		);
		await expect(card.getByTestId("ask-continue")).toHaveCount(0);
		await expect(card.getByTestId("ask-submit")).toBeDisabled();
		await card.getByTestId("ask-option").first().click();
		await expect(card.getByTestId("ask-submit")).toBeEnabled();
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a coarse pointer reveals a returning page's text target without focusing it", async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 1280, height: 640 },
	});
	const page = await context.newPage();
	await openFixtureProject(page);
	const session = seedPanedQuestionnaire("touch questionnaire", "ask-touch-pages");

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "touch questionnaire");

		const chatScroll = page.getByTestId("chat-scroll");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		await expect(card).toBeVisible();
		await waitForScrollStability(chatScroll);
		await card.getByTestId("ask-option").first().click();
		const next = card.getByTestId("ask-continue");
		await wheelUntilChatElementIntersects(page, chatScroll, next);
		await next.click();

		const custom = card.getByTestId("ask-custom");
		await custom.fill("Use a custom second-stage rollout.");
		await expect(custom).toBeFocused();
		await card.getByTestId("ask-tab").first().click();
		await expect(card.getByTestId("ask-question-text")).toHaveText(
			"Which first-page rollout should we use?",
		);
		await wheelUntilChatElementIntersects(page, chatScroll, next);
		await next.click();

		const secondHeading = card.getByTestId("ask-question-text");
		await expect(secondHeading).toHaveText("Which second-page rollout should we use?");
		await expect
			.poll(async () => ({
				heading: (await readChatViewportIntersection(secondHeading)).intersects,
				custom: (await readChatViewportIntersection(custom)).intersects,
			}))
			.toEqual({ heading: true, custom: true });
		await expect(custom).not.toBeFocused();
		expect(await nestedVerticalScrollSurfaces(card)).toEqual([]);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	} finally {
		rmSync(session.path, { force: true });
		await context.close();
	}
});

async function box(
	locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const measured = await locator.boundingBox();
	if (!measured) throw new Error("element has no box");
	return measured;
}

function activeAsk(page: Page): Locator {
	return page.locator('[data-testid="ask-user-question"][data-tone="active"]');
}

async function expectSessionToContain(path: string, needle: string): Promise<void> {
	await expect
		.poll(() => readFileSync(path, "utf8").includes(needle), { timeout: 10_000 })
		.toBe(true);
}

const GEOMETRY_ROUND = {
	questions: [
		{
			question: "Which short rollout should we use?",
			header: "Short",
			options: [
				{ label: "Short alpha", description: "One line." },
				{ label: "Short beta", description: "One line." },
			],
		},
		{
			question:
				"Which long rollout should we use when the host restarts in the middle of a review?",
			header: "Long",
			options: [
				{
					label: "Long alpha (Recommended)",
					description:
						"Store the queue next to the transcript so it replays with the session and survives every host restart without a second store.",
					recommendedReason: "The session already owns this state.",
				},
				{ label: "Long beta", description: "Write a separate file per workspace." },
				{ label: "Long gamma", description: "Keep a shared index across workspaces." },
				{ label: "Long delta", description: "Keep it in memory only." },
			],
		},
		{
			question: "Which checks should the long rollout run?",
			header: "Checks",
			multiSelect: true,
			options: [
				{ label: "Check lint", description: "Biome." },
				{ label: "Check types", description: "tsc." },
				{ label: "Check units", description: "bun test." },
			],
		},
	],
} satisfies AskUserQuestionArgs;

test("paging and choosing never move the tabs, the question or the footer", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await openFixtureProject(page);
	const session = seedQuestionnaire("steady paging", "ask-steady-paging", GEOMETRY_ROUND);

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "steady paging");
		const chatScroll = page.getByTestId("chat-scroll");
		const card = activeAsk(page);
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await waitForScrollStability(chatScroll);

		const footer = card.locator('[data-testid="ask-continue"], [data-testid="ask-submit"]');
		const geometry = async () => ({
			tabs: (await box(card.getByTestId("ask-tab").first())).y,
			question: (await box(card.getByTestId("ask-question-text"))).y,
			footer: (await box(footer)).y,
			height: (await box(card)).height,
		});
		const first = await geometry();
		await card.getByTestId("ask-tab").nth(1).click();
		await expect(card.getByTestId("ask-question-text")).toHaveText(/long rollout/);
		expect(await geometry()).toEqual(first);
		await card.getByTestId("ask-continue").click();
		await expect(card.getByTestId("ask-question-text")).toHaveText(/checks/);
		await waitForScrollStability(chatScroll);
		expect(await geometry()).toEqual(first);
		await page.keyboard.press("ArrowLeft");
		await expect(card.getByTestId("ask-question-text")).toHaveText(/long rollout/);
		expect(await geometry()).toEqual(first);

		const other = card.getByTestId("ask-custom-row");
		const otherTop = (await box(other)).y;
		await card.getByTestId("ask-option").nth(0).click();
		await expect(card.getByTestId("ask-note-toggle")).toBeVisible();
		expect((await box(other)).y).toBe(otherTop);
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(card.getByTestId("ask-option").nth(1)).toHaveAttribute("data-selected", "true");
		expect((await box(other)).y).toBe(otherTop);
		expect(await geometry()).toEqual(first);
		expect(await nestedVerticalScrollSurfaces(card)).toEqual([]);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("a note and Other grow in place, the note follows the pick, and the card keeps its largest height", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await openFixtureProject(page);
	const session = seedQuestionnaire("growing fields", "ask-growing-fields", KEYBOARD_ROUND);

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "growing fields");
		const card = activeAsk(page);
		const options = card.getByTestId("ask-option");
		await expect(options.first()).toBeFocused();
		const resting = (await box(card)).height;

		await options.first().click();
		await card.getByTestId("ask-note-toggle").click();
		await expect(card.getByTestId("ask-note")).toBeFocused();
		for (const line of ["First line", "Second line", "Third line", "Fourth line"]) {
			await page.keyboard.type(line);
			await page.keyboard.press("Shift+Enter");
		}
		await page.keyboard.type("Fifth line");
		const typed = (await box(card)).height;
		expect(typed).toBeGreaterThan(resting);

		await page.keyboard.press("Enter");
		await expect(card.getByTestId("ask-note")).toHaveCount(0);
		await expect(card.getByTestId("ask-note-text")).toContainText("Fifth line");
		await expect(card.getByTestId("ask-note-toggle")).toHaveAccessibleDescription(/Fifth line/);
		expect((await box(card)).height).toBeGreaterThanOrEqual(typed - 0.5);

		await options.nth(2).click();
		const note = card.getByTestId("ask-note-text");
		await expect(note).toContainText("First line");
		expect((await box(note)).y).toBeGreaterThan((await box(options.nth(2))).y);

		await card.getByTestId("ask-tab").nth(1).click();
		await expect(card.getByTestId("ask-question-text")).toHaveText(
			"Which keyboard checks should run?",
		);
		expect((await box(card)).height).toBeGreaterThanOrEqual(typed - 0.5);

		const custom = card.getByTestId("ask-custom");
		await custom.fill(Array.from({ length: 14 }, (_, i) => `Own answer line ${i + 1}`).join("\n"));
		await expect
			.poll(() => custom.evaluate((field) => field.scrollHeight > field.clientHeight + 1))
			.toBe(true);
		const surfaces = await nestedVerticalScrollSurfaces(card);
		expect(surfaces.map((surface) => surface.testId)).toEqual(["ask-custom"]);

		await custom.fill("");
		await card.getByTestId("ask-tab").first().click();
		expect((await box(card)).height).toBeGreaterThanOrEqual(typed - 0.5);
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Discuss marks a question, choosing cancels it, and the round sends the discussion with the answers", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("discuss round", "ask-discuss-round", KEYBOARD_ROUND);

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "discuss round");
		const card = activeAsk(page);
		const tabs = card.getByTestId("ask-tab");
		await expect(card.getByTestId("ask-option").first()).toBeFocused();

		await card.getByTestId("ask-discuss").click();
		await expect(card.getByTestId("ask-discuss-panel")).toBeVisible();
		await expect(card.getByTestId("ask-discuss-text")).toBeFocused();
		await page.keyboard.type("What does a rollout change for me?");
		const unclear = card.locator('[data-testid="ask-discuss-reason"][data-reason="unclear"]');
		await unclear.click();
		await expect(unclear).toHaveAttribute("aria-pressed", "true");
		await expect(tabs.first()).toHaveAttribute("data-discuss", "true");

		await card.getByTestId("ask-option").nth(1).click();
		await expect(card.getByTestId("ask-discuss-panel")).toHaveCount(0);
		await expect(card.getByTestId("ask-discuss")).toHaveAttribute("data-active", "false");
		await expect(tabs.first()).toHaveAttribute("data-discuss", "false");

		await card.getByTestId("ask-discuss").click();
		await expect(card.getByTestId("ask-discuss-text")).toHaveValue(
			"What does a rollout change for me?",
		);
		await expect(unclear).toHaveAttribute("aria-pressed", "true");

		await card.getByTestId("ask-continue").click();
		await clickTranscriptControl(card.getByTestId("ask-option").first());
		await clickTranscriptControl(card.getByTestId("ask-submit"));
		await expect(card.getByTestId("ask-submit")).toHaveCount(0);

		const record = page.locator('[data-testid="ask-user-question"][data-tone="answered"]');
		await expect(record.getByTestId("ask-receipt-toggle")).toContainText(
			"Answered 1 of 2 questions",
		);
		await expect(record.getByTestId("ask-receipt-toggle")).toContainText("1 to discuss");
		const pair = record.getByTestId("ask-receipt-pair").first();
		await expect(pair.getByTestId("ask-receipt-answer")).toContainText("Let’s discuss first");
		await expect(pair.getByTestId("ask-receipt-answer")).toContainText("Unclear");
		await expect(pair).toContainText("“What does a rollout change for me?”");
		await expectSessionToContain(session.path, '"kind":"discuss"');
		await expectSessionToContain(session.path, '"reason":"unclear"');
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("Other, notes and Discuss park on their own row, and the platform chord submits", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("keyboard discuss", "ask-keyboard-discuss", {
		questions: [KEYBOARD_ROLLOUT],
	});

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "keyboard discuss");
		const card = activeAsk(page);
		const options = card.getByTestId("ask-option");
		const custom = card.getByTestId("ask-custom");
		const customRow = card.getByTestId("ask-custom-row");
		await expect(options.first()).toBeFocused();

		await page.keyboard.press("End");
		await expect(custom).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(options.first()).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(custom).toBeFocused();

		await page.keyboard.type("draft");
		await expect(customRow).toHaveAttribute("data-selected", "true");
		await page.keyboard.press("Enter");
		await expect(customRow).toBeFocused();
		await expect(custom).toHaveValue("draft");
		await page.keyboard.press("Enter");
		await expect(custom).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(customRow).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(card.getByTestId("ask-submit")).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(custom).toBeFocused();

		await page.keyboard.press("Shift+Tab");
		await expect(options.last()).toBeFocused();
		await page.keyboard.press("d");
		const discussText = card.getByTestId("ask-discuss-text");
		await expect(discussText).toBeFocused();
		await page.keyboard.type("Explain the rollouts first.");
		await page.keyboard.press("Enter");
		const panel = card.getByTestId("ask-discuss-panel");
		await expect(panel).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(discussText).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(panel).toBeFocused();
		await page.keyboard.press("Tab");
		const reason = card.getByTestId("ask-discuss-reason").first();
		await expect(reason).toBeFocused();
		await page.keyboard.press("Space");
		await expect(reason).toHaveAttribute("aria-pressed", "true");

		await pressPlatformShortcut(page, "Enter");
		const record = page.locator('[data-testid="ask-user-question"][data-tone="answered"]');
		await expect(record.getByTestId("ask-receipt-answer")).toContainText("Let’s discuss first");
		await expect(record).toContainText("“Explain the rollouts first.”");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("the platform chord with nothing answered asks for a choice instead of sending", async ({
	page,
}) => {
	await openFixtureProject(page);
	const session = seedQuestionnaire("empty chord", "ask-empty-chord", {
		questions: [KEYBOARD_ROLLOUT],
	});

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "empty chord");
		const card = activeAsk(page);
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		await pressPlatformShortcut(page, "Enter");
		await expect(card.getByTestId("ask-needs-choice")).toBeVisible();
		await expect(card).toHaveAttribute("data-tone", "active");
		await page.keyboard.press("Enter");
		await expect(card.getByTestId("ask-needs-choice")).toHaveCount(0);
		await expect(card.getByTestId("ask-shortcuts")).toContainText("Enter select");
		await expect(card.getByTestId("ask-shortcuts")).toContainText("Space note");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("the receipt folds to one line, remembers a manual fold and lists each question's options", async ({
	page,
}) => {
	await openFixtureProject(page);
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [
			{
				questionIndex: 0,
				question: KEYBOARD_ROLLOUT.question,
				kind: "option",
				answer: "Keyboard beta",
				notes: "Only on weekdays.",
			},
			{
				questionIndex: 1,
				question: "Which keyboard checks should run?",
				kind: "multi",
				answer: "also the smoke run",
				selected: ["Keyboard lint", "Keyboard units"],
			},
		],
	};
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "receipt fold",
		messages: [
			{ role: "user", text: "Ask me these questions.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "ask-receipt-fold",
						name: "ask_user_question",
						arguments: KEYBOARD_ROUND,
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "ask-receipt-fold",
				toolName: "ask_user_question",
				content: [{ type: "text", text: "User has answered your questions." }],
				details: result,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChat(page, "receipt fold");
		const record = page.locator('[data-testid="ask-user-question"][data-tone="answered"]');
		const header = record.getByTestId("ask-receipt-toggle");
		await expect(header).toHaveAttribute("aria-expanded", "true");
		await expect(header).toContainText("Answered 2 questions");
		const pairs = record.getByTestId("ask-receipt-pair");
		await expect(pairs).toHaveCount(2);
		await expect(pairs.first().getByTestId("ask-receipt-answer")).toHaveText("Keyboard beta");
		await expect(pairs.first()).toContainText("“Only on weekdays.”");
		await expect(pairs.nth(1).getByTestId("ask-receipt-answer")).toContainText(
			"Keyboard lint, Keyboard units",
		);
		await expect(record.getByTestId("ask-record-option")).toHaveCount(0);

		await pairs.nth(1).getByTestId("ask-receipt-options-toggle").click();
		const listed = pairs.nth(1).getByTestId("ask-record-option");
		await expect(listed).toHaveCount(3);
		await expect(listed.nth(0)).toHaveAttribute("data-selected", "true");
		await expect(listed.nth(1)).toHaveAttribute("data-selected", "false");
		await expect(listed.nth(1).getByTestId("ask-selection-status")).toHaveText("Not selected:");
		await expect(pairs.nth(1).getByTestId("ask-record-custom")).toContainText("also the smoke run");

		await header.click();
		await expect(header).toHaveAttribute("aria-expanded", "false");
		await expect(pairs).toHaveCount(0);
		await expect(record.getByTestId("ask-receipt-summary")).toContainText("Keyboard beta");

		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		await chatTabs.first().getByTestId("editor-tab-close").click();
		await expect(chatTabs).toHaveCount(0);
		await openPersistedChat(page, "receipt fold");
		await expect(
			page
				.locator('[data-testid="ask-user-question"][data-tone="answered"]')
				.getByTestId("ask-receipt-toggle"),
		).toHaveAttribute("aria-expanded", "false");
	} finally {
		rmSync(session.path, { force: true });
	}
});

test("an expanded question preview stays expanded when its chat is reopened", async ({ page }) => {
	await openFixtureProject(page);
	const session = seedTallQuestionnaire("expanded preview", "ask-expanded-preview");

	try {
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openPersistedChatAfterInput(page, "expanded preview");
		const card = activeAsk(page);
		await expect(card.getByTestId("ask-option").first()).toBeFocused();
		const toggle = card.getByTestId("ask-question-preview-toggle");
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-expanded", "true");

		const chatTabs = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
		await chatTabs.first().getByTestId("editor-tab-close").click();
		await expect(chatTabs).toHaveCount(0);
		await openPersistedChat(page, "expanded preview");
		await expect(activeAsk(page).getByTestId("ask-question-preview-toggle")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
	} finally {
		rmSync(session.path, { force: true });
	}
});
