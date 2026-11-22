import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type {
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/pi-ask-user-question/core";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	openSettingsSection,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";

const BASE_TS = 1_700_930_000_000;

async function openExtensionsSettings(page: Page) {
	await openSettingsSection(page, "extensions");
	const section = page.getByTestId("settings-extensions");
	await expect(section).toBeVisible();
	return section;
}

const EXTENSIONS = [
	{ name: "visualize", title: "Visualize", tool: "visualize" },
	{ name: "ask-user-question", title: "Ask user question", tool: "ask_user_question" },
	{ name: "web-access", title: "Web access", tool: "web_search" },
	{ name: "next-steps", title: "Next-step suggestions", tool: "suggest_next_steps" },
	{ name: "outputs", title: "Outputs", tool: "present_files" },
] as const;

async function setExtension(page: Page, name: string, enabled: boolean): Promise<void> {
	await closeSettings(page);
	await openExtensionsSettings(page);
	const toggle = page.getByTestId(`extension-toggle-${name}`);
	if ((await toggle.getAttribute("data-active")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(enabled));
	await closeSettings(page);
}

const RICH_PREVIEWS = "extension-setting-toggle-ask-user-question-richPreviews";

const WEB_ONLY = "hint-mode";

test.afterEach(async ({ page }) => {
	if (page.isClosed()) return;
	for (const name of [...EXTENSIONS.map((extension) => extension.name), WEB_ONLY]) {
		await setExtension(page, name, true);
	}
	await openExtensionsSettings(page);
	const richPreviews = page.getByTestId(RICH_PREVIEWS);
	if ((await richPreviews.getAttribute("data-active")) !== "true") await richPreviews.click();
	await expect(richPreviews).toHaveAttribute("data-active", "true");
	await closeSettings(page);
});

test("the questionnaire's rich-preview switch sits under its extension, survives a reload and follows the extension", async ({
	page,
}) => {
	await openFixtureProject(page);
	const section = await openExtensionsSettings(page);
	const row = section.getByTestId("extension-setting-ask-user-question-richPreviews");
	await expect(row).toContainText("Rich previews in questions");
	const toggle = row.getByTestId(RICH_PREVIEWS);
	await expect(toggle).toHaveAttribute("data-active", "true");
	await expect(toggle).toBeEnabled();

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await closeSettings(page);
	await page.reload();
	await openExtensionsSettings(page);
	await expect(page.getByTestId(RICH_PREVIEWS)).toHaveAttribute("data-active", "false");

	await page.getByTestId("extension-toggle-ask-user-question").click();
	await expect(page.getByTestId(RICH_PREVIEWS)).toBeDisabled();
	await page.getByTestId("extension-toggle-ask-user-question").click();
	await expect(page.getByTestId(RICH_PREVIEWS)).toBeEnabled();
	await closeSettings(page);
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

test("Settings → Extensions lists the web-only Hint mode after the host's extensions, without tool chips, and its switch survives a reload", async ({
	page,
}) => {
	await openFixtureProject(page);
	const section = await openExtensionsSettings(page);
	const rows = section.locator('[data-testid^="extension-row-"]');
	await expect(rows.last()).toHaveAttribute("data-testid", `extension-row-${WEB_ONLY}`);
	const row = section.getByTestId(`extension-row-${WEB_ONLY}`);
	await expect(row).toContainText("Hint mode");
	await expect(row).toContainText("Applies right away.");
	await expect(row.locator('[data-testid^="extension-tool-"]')).toHaveCount(0);
	const toggle = row.getByTestId(`extension-toggle-${WEB_ONLY}`);
	await expect(toggle).toHaveAttribute("aria-checked", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await closeSettings(page);
	await page.reload();
	await openExtensionsSettings(page);
	await expect(page.getByTestId(`extension-toggle-${WEB_ONLY}`)).toHaveAttribute(
		"aria-checked",
		"false",
	);
	for (const { name } of EXTENSIONS) {
		await expect(page.getByTestId(`extension-toggle-${name}`)).toHaveAttribute(
			"aria-checked",
			"true",
		);
	}
});

test("a historical questionnaire still renders its answers while the extension is off", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setExtension(page, "ask-user-question", false);
	const args = {
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
	} satisfies AskUserQuestionArgs;
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
