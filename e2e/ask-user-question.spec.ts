import { realpathSync, rmSync, utimesSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type {
	AskUserQuestionAckDetails,
	AskUserQuestionArgs,
	AskUserQuestionOption,
} from "@thinkrail/contracts";
import {
	enterDefaultWorkspace,
	hideAuxiliaryWorkbench,
	openChatFromHistory,
	openFixtureProject,
} from "./fixtures/app";
import {
	moveMouseToChatViewport,
	nestedVerticalScrollSurfaces,
	readChatScrollGeometry,
	readChatViewportIntersection,
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

function optionsFor(pageName: string): AskUserQuestionOption[] {
	return [
		{
			label: `${pageName} alpha`,
			description: "Use the first deterministic fixture choice.",
			preview: tallPreview(pageName),
		},
		{ label: `${pageName} beta`, description: "Use the second deterministic fixture choice." },
		{ label: `${pageName} gamma`, description: "Use the third deterministic fixture choice." },
	];
}

async function selectOldestFirst(page: Page): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-chat").click();
	const option = page.getByTestId("chat-order-oldest-first");
	await option.click();
	await expect(option).toHaveAttribute("data-active", "true");
	await page.keyboard.press("Escape");
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

test("a persisted tall questionnaire reveals the next page in the transcript without nested scrolling", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await openFixtureProject(page);

	const toolCallId = "ask-tall-pages";
	const args: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which first-page rollout should we use?",
				header: "First page",
				options: optionsFor("First"),
			},
			{
				question: "Which second-page rollout should we use?",
				header: "Second page",
				options: optionsFor("Second"),
			},
		],
	};
	const ack: AskUserQuestionAckDetails = { kind: "ack" };
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "tall persisted questionnaire",
		messages: [
			{ role: "user", text: "Ask me to choose both rollout stages.", timestamp: BASE_TS },
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

	try {
		await selectOldestFirst(page);
		await enterDefaultWorkspace(page);
		await hideAuxiliaryWorkbench(page);
		await openChatFromHistory(page, "tall persisted questionnaire");

		const chatScroll = page.getByTestId("chat-scroll");
		const card = page.locator('[data-testid="ask-user-question"][data-tone="active"]');
		await expect(card).toBeVisible();
		await expect(card.getByTestId("ask-question-text")).toHaveText(
			"Which first-page rollout should we use?",
		);

		const firstOption = card.getByTestId("ask-option").first();
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
		expect(await nestedVerticalScrollSurfaces(card)).toEqual([]);
		await expect(chatScroll).toHaveAttribute("data-follow-state", "detached");
	} finally {
		rmSync(session.path, { force: true });
	}
});
