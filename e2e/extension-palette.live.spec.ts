import { expect, test } from "@playwright/test";
import {
	activeWorktreeRow,
	createWorkspaceViaDialog,
	openFixtureProject,
	waitForAgentSettled,
	worktreeRows,
} from "./fixtures/app";
import {
	clearInstalledExtensions,
	declareExtensions,
	PALETTE_DIR,
	PALETTE_HEXES,
	PALETTE_NAME,
} from "./fixtures/installedExtensions";

test.afterEach(async ({ page }) => {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	await clearInstalledExtensions(page);
});

test("the agent calls an installed extension's tool and its card renders in chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(180_000);
	await openFixtureProject(page);
	const [entry] = await declareExtensions(page, [PALETTE_DIR]);
	expect(entry).toMatchObject({ name: PALETTE_NAME, state: "loaded", tools: ["color_palette"] });
	await createWorkspaceViaDialog(page);
	await worktreeRows(page).first().getByRole("button").first().click();
	await expect(activeWorktreeRow(page)).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await page
		.getByTestId("chat-input")
		.fill(
			"Call the color_palette tool exactly once with base '#3b82f6' and harmony 'triadic'. Use no other tool, then reply with one short sentence.",
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator('[data-testid="tool-card"][data-tool="color_palette"]').first();
	await expect(card).toBeVisible({ timeout: 120_000 });
	await expect(card.getByTestId("palette-card")).toBeVisible({ timeout: 60_000 });
	const swatches = card.getByTestId("palette-swatch");
	await expect(swatches).toHaveCount(5);
	for (const [index, hex] of PALETTE_HEXES.entries()) {
		await expect(swatches.nth(index)).toContainText(hex);
	}
	await expect(card.locator("[data-rating]")).toHaveCount(5);
	await waitForAgentSettled(page);
});
