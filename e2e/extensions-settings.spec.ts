import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
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

async function setVisualize(page: Page, enabled: boolean): Promise<void> {
	await closeSettings(page);
	await openExtensionsSettings(page);
	const toggle = page.getByTestId("extension-toggle-visualize");
	if ((await toggle.getAttribute("data-active")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", String(enabled));
	await closeSettings(page);
}

test.afterEach(async ({ page }) => {
	if (!page.isClosed()) await setVisualize(page, true);
});

test("Settings → Extensions lists visualize and its switch survives a reload", async ({ page }) => {
	await openFixtureProject(page);
	const section = await openExtensionsSettings(page);
	const row = section.getByTestId("extension-row-visualize");
	await expect(row).toContainText("Visualize");
	await expect(row.getByTestId("extension-tool-visualize")).toHaveText("visualize");
	const toggle = row.getByTestId("extension-toggle-visualize");
	await expect(toggle).toHaveAttribute("aria-checked", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await closeSettings(page);

	await page.reload();
	await openExtensionsSettings(page);
	await expect(page.getByTestId("extension-toggle-visualize")).toHaveAttribute(
		"aria-checked",
		"false",
	);
});

test("a historical visualize call still renders its diagram while the extension is off", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setVisualize(page, false);
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
