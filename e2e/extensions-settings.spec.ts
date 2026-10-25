import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { AskUserQuestionArgs, AskUserQuestionResult } from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_930_000_000;

async function openExtensionsSettings(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const section = page.getByTestId("settings-extensions");
	await expect(section).toBeVisible();
	return section;
}

async function closeSettings(page: Page): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) return;
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

const EXTENSIONS = [
	{ name: "visualize", title: "Visualize", tool: "visualize" },
	{ name: "ask-user-question", title: "Ask user question", tool: "ask_user_question" },
] as const;

async function setExtension(page: Page, name: string, enabled: boolean): Promise<void> {
	await closeSettings(page);
	await openExtensionsSettings(page);
	const toggle = page.getByTestId(`extension-toggle-${name}`);
	if ((await toggle.getAttribute("data-active")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(enabled));
	await closeSettings(page);
}

test.afterEach(async ({ page }) => {
	if (page.isClosed()) return;
	for (const { name } of EXTENSIONS) await setExtension(page, name, true);
});

for (const { name, title, tool } of EXTENSIONS) {
	test(`Settings → Extensions lists ${name} and its switch survives a reload`, async ({ page }) => {
		await openFixtureProject(page);
		const section = await openExtensionsSettings(page);
		const row = section.getByTestId(`extension-row-${name}`);
		await expect(row).toContainText(title);
		await expect(row.getByTestId(`extension-tool-${tool}`)).toHaveText(tool);
		const toggle = row.getByTestId(`extension-toggle-${name}`);
		await expect(toggle).toHaveAttribute("aria-checked", "true");

		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-checked", "false");
		await closeSettings(page);

		await page.reload();
		await openExtensionsSettings(page);
		await expect(page.getByTestId(`extension-toggle-${name}`)).toHaveAttribute(
			"aria-checked",
			"false",
		);
	});
}

test("a historical questionnaire still renders its answers while the extension is off", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setExtension(page, "ask-user-question", false);
	const args: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which runtime?",
				header: "Runtime",
				options: [
					{ label: "Bun", description: "fast" },
					{ label: "Node", description: "compatible" },
				],
			},
		],
	};
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which runtime?", kind: "option", answer: "Bun" }],
	};
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "historical questionnaire",
		messages: [
			{ role: "user", text: "Ask me.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "ask-old", name: "ask_user_question", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "ask-old",
				toolName: "ask_user_question",
				content: [
					{ type: "text", text: 'User has answered your questions: "Which runtime?"="Bun".' },
				],
				details: result,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "historical questionnaire");
	const card = page.locator('[data-testid="ask-user-question"][data-tone="answered"]');
	await expect(card).toBeVisible();
	await expect(card).toContainText("Which runtime?");
	await expect(card).toContainText("Bun");
});

test("a historical visualize call still renders its diagram while the extension is off", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setExtension(page, "visualize", false);
	const args = {
		type: "diagram",
		title: "Historical path",
		mermaid: "flowchart LR; Before --> After",
	};
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "historical visualize",
		messages: [
			{ role: "user", text: "Draw it.", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "visualize-old", name: "visualize", arguments: args }],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "visualize-old",
				toolName: "visualize",
				content: [{ type: "text", text: "Visualization complete." }],
				details: args,
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "historical visualize");
	const card = page.locator('[data-testid="tool-card"][data-tool="visualize"]');
	await expect(card).toHaveCount(1);
	const diagram = card.getByTestId("tool-visualize-diagram");
	await expect(diagram).toBeVisible();
	await expect(diagram.getByTestId("mermaid-svg").locator("svg")).toBeVisible({
		timeout: 20_000,
	});
});
