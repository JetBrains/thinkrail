import { expect, type Locator, type Page, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

/**
 * The model picker's two tiers + the Settings → Models manager (pi's `enabledModels` allowlist).
 *
 * No-agent suite: the picker only has rows when the host has an authenticated provider, which this suite
 * deliberately does not require (CI runs without auth). So each case asserts what holds either way and
 * skips the model-dependent half when nothing resolved — the same guard `new-workspace.spec.ts` uses for
 * the effort pill. The ordering/collapse/allowlist rules themselves are pinned host-side in
 * `packages/server/src/agent/modelCatalog.test.ts`, not through the browser.
 *
 * Nothing here may call a state-resetting fixture mid-test: `resetState` strips `enabledModels` (see
 * fixtures/app.ts), which is exactly the setting these cases write.
 */

/** Did this locator show up within the budget? (A missing one is an answer here, not a failure.) */
const appears = (locator: Locator, timeout = 8_000): Promise<boolean> =>
	locator
		.first()
		.waitFor({ state: "visible", timeout })
		.then(
			() => true,
			() => false,
		);

const primaryRows = (page: Page): Locator =>
	page.locator('[data-testid="model-option"][data-tier="primary"]');
const extraRows = (page: Page): Locator =>
	page.locator('[data-testid="model-option"][data-tier="extra"]');

/**
 * Open the New-Workspace dialog's model picker in an already-open project (no state reset).
 * Returns false when no provider is authenticated — the caller then skips.
 */
async function openPicker(page: Page): Promise<boolean> {
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();

	// The dialog resolves its default model over the wire, so "Select model" only means "no provider
	// authenticated" once that read has had a chance to land.
	const trigger = dialog.getByTestId("model-selector");
	await expect(trigger).toBeVisible();
	if (!(await appears(dialog.getByTestId("model-selector").filter({ hasNotText: "Select model" }))))
		return false;
	await trigger.click();
	await expect(trigger).toHaveAttribute("data-open", "true");
	return true;
}

/** Re-open the picker inside an already-open dialog (its query + "Show all" reset on close). */
async function reopenPicker(page: Page): Promise<void> {
	const trigger = page.getByTestId("new-workspace-dialog").getByTestId("model-selector");
	await trigger.click();
	await expect(trigger).toHaveAttribute("data-open", "true");
}

/** Close the picker popover, then the dialog. */
async function closePicker(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("new-workspace-dialog")).toBeHidden();
}

test("the picker shows an everyday tier, reveals the rest behind Show all, and searches both", async ({
	page,
}) => {
	await openFixtureProject(page);
	if (!(await openPicker(page))) test.skip(true, "no authenticated provider — nothing to pick");

	// The default tier is the everyday list: primary rows only, nothing from the extra tier.
	const primaryCount = await primaryRows(page).count();
	expect(primaryCount).toBeGreaterThan(0);
	await expect(extraRows(page)).toHaveCount(0);

	// A real pi catalog always has a second tier (the dated snapshots at least); if this host's doesn't,
	// the row is correctly absent and there is nothing to reveal.
	const showAll = page.getByTestId("model-show-all");
	if (!(await showAll.isVisible())) {
		await closePicker(page);
		test.skip(true, "this host's catalog has no hidden models");
	}
	await showAll.click();
	await expect(showAll).toBeHidden();
	const hidden = await extraRows(page).count();
	expect(hidden).toBeGreaterThan(0);
	const hiddenId = await extraRows(page).first().getAttribute("data-model-id");

	// Typing reaches the extra tier without expanding first — a hidden model is never unreachable.
	await page.keyboard.press("Escape"); // close the popover, keep the dialog open
	await reopenPicker(page);
	await expect(extraRows(page)).toHaveCount(0); // reopening resets to the everyday tier
	await page.getByPlaceholder("Search models…").fill(hiddenId ?? "");
	await expect(
		page.locator(`[data-testid="model-option"][data-model-id="${hiddenId}"]`),
	).toBeVisible();
	await expect(showAll).toBeHidden(); // a query expands the list, so the row has nothing left to do
	await closePicker(page);
});

test("Settings → Models curates what the picker offers day to day", async ({ page }) => {
	await openFixtureProject(page);

	const openModelsSettings = async (): Promise<Locator> => {
		await page.getByTestId("open-settings").click();
		await expect(page.getByTestId("settings-dialog")).toBeVisible();
		await page.getByTestId("settings-nav-models").click();
		const panel = page.getByTestId("settings-models");
		await expect(panel).toBeVisible();
		return panel;
	};

	let panel = await openModelsSettings();
	// Same asynchrony as the picker: the panel fetches `model.list` on mount.
	const rows = panel.getByTestId("model-setting-row");
	if (!(await appears(rows))) {
		await expect(panel).toContainText("sign in to a provider first");
		test.skip(true, "no authenticated provider — nothing to curate");
	}

	// Every model starts available (no allowlist), and the manager says exactly that.
	await expect(panel.getByTestId("models-enabled-count")).toContainText("All ");
	await expect(panel.getByTestId("models-enable-all")).toBeHidden();

	// Turning one off is persisted host-side and broadcast back — the row and the header both repaint from
	// the host's frame, never optimistically.
	const total = await rows.count();
	const victim = rows.first();
	const victimId = await victim.getAttribute("data-model-id");
	await victim.getByTestId("model-toggle").click();
	await expect(victim).toHaveAttribute("data-enabled", "false");
	await expect(panel.getByTestId("models-enabled-count")).toContainText(`${total - 1} of ${total}`);

	// …and the picker follows: the disabled model leaves the everyday tier. It stays reachable under
	// "Show all", which is what makes this a curation rather than a deletion.
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
	expect(await openPicker(page)).toBe(true);
	await expect(primaryRows(page).filter({ hasText: victimId ?? "" })).toHaveCount(0);
	await page.getByTestId("model-show-all").click();
	await expect(extraRows(page).filter({ hasText: victimId ?? "" })).toHaveCount(1);
	await closePicker(page);

	// Enable all clears the allowlist entirely (pi stores "no filter" as an absent setting).
	panel = await openModelsSettings();
	await panel.getByTestId("models-enable-all").click();
	await expect(panel.getByTestId("models-enabled-count")).toContainText("All ");
	await expect(panel.getByTestId("models-enable-all")).toBeHidden();
});
