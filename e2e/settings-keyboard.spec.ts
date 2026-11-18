import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	closeSettings,
	openFixtureProject,
	openSettingsSection,
	settingsDialog,
} from "./fixtures/app";

const tab = (page: Page, id: string) => page.getByTestId(`settings-nav-${id}`);
const searchField = (page: Page) => page.getByTestId("settings-search");
const focusIn = (page: Page, selector: string) =>
	page.evaluate((within) => document.activeElement?.closest(within) != null, selector);
const focusedRow = (page: Page) =>
	page.evaluate(
		() =>
			document.activeElement?.closest("[data-setting-row]")?.getAttribute("data-setting-row") ??
			null,
	);

function windowsShortcuts(page: Page) {
	return page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" });
		Reflect.set(
			window,
			"__THINKRAIL_NATIVE_SHORTCUTS__",
			Object.freeze({
				subscribeQuitHint: () => () => {},
				subscribeCommand: () => () => {},
				quit: async () => {},
			}),
		);
	});
}

async function openFromGear(page: Page): Promise<Locator> {
	const opener = page.getByTestId("open-settings");
	await opener.focus();
	await page.keyboard.press("Enter");
	await expect(settingsDialog(page)).toBeVisible();
	return opener;
}

async function expectSection(page: Page, id: string): Promise<void> {
	await expect(tab(page, id)).toBeFocused();
	await expect(tab(page, id)).toHaveAttribute("data-active", "true");
	await expect(tab(page, id)).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#settings-panel")).toHaveAttribute(
		"aria-labelledby",
		`settings-tab-${id}`,
	);
}

test("opening lands on the current section's tab; Tab goes search → the one nav stop → content", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "privacy");
	await closeSettings(page);

	await openFromGear(page);
	await expectSection(page, "privacy");
	await expect(settingsDialog(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
	await expect(settingsDialog(page).getByRole("tablist")).toHaveAttribute(
		"aria-orientation",
		"vertical",
	);

	await page.keyboard.press("Shift+Tab");
	await expect(searchField(page)).toBeFocused();
	await expect(searchField(page)).toHaveAttribute("placeholder", "Search settings");
	await page.keyboard.press("Tab");
	await expect(tab(page, "privacy")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect.poll(() => focusIn(page, "[data-settings-content]")).toBe(true);
});

test("↑/↓/j/k/Home/End open a section at once and keep focus on its tab; other letters do nothing", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "appearance");

	await page.keyboard.press("ArrowDown");
	await expectSection(page, "text");
	await expect(page.getByTestId("settings-text")).toBeVisible();
	await page.keyboard.press("j");
	await expectSection(page, "chat");
	await expect(page.getByTestId("settings-chat")).toBeVisible();
	await page.keyboard.press("k");
	await expectSection(page, "text");
	await page.keyboard.press("ArrowUp");
	await expectSection(page, "appearance");
	await page.keyboard.press("End");
	await expectSection(page, "feedback");
	await expect(page.getByTestId("settings-feedback")).toBeVisible();
	await page.keyboard.press("Home");
	await expectSection(page, "models");

	for (const letter of ["x", "q", "1"]) await page.keyboard.press(letter);
	await expectSection(page, "models");
	await page.keyboard.press("ArrowLeft");
	await expectSection(page, "models");
});

test("→, l and Enter go into the content on the setting focused last there, else on its first; ← comes back", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "feedback");
	const rows = settingsDialog(page).locator("#settings-panel [data-setting-row]");
	await expect(rows.first()).toBeVisible();
	const first = await rows.first().getAttribute("data-setting-row");
	const second = await rows.nth(1).getAttribute("data-setting-row");

	await page.keyboard.press("ArrowRight");
	await expect.poll(() => focusedRow(page)).toBe(first);
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("k");
	await expect.poll(() => focusedRow(page)).toBe(first);
	await page.keyboard.press("j");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("ArrowLeft");
	await expectSection(page, "feedback");

	await page.keyboard.press("ArrowUp");
	await expectSection(page, "privacy");
	await page.keyboard.press("Enter");
	await expect.poll(() => focusedRow(page)).toBe("usage-analytics");
	await page.keyboard.press("h");
	await expectSection(page, "privacy");

	await page.keyboard.press("ArrowDown");
	await expectSection(page, "feedback");
	await page.keyboard.press("l");
	await expect.poll(() => focusedRow(page)).toBe(second);
});

test("Esc steps back: a dirty field reverts, then the section list, then Settings closes onto its opener", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "text");
	await closeSettings(page);
	const opener = await openFromGear(page);
	await expectSection(page, "text");

	const input = page.getByTestId("chat-line-width-input");
	const saved = await input.inputValue();
	await input.fill(String(Number(saved) + 7));
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue(saved);
	await expect(input).toBeFocused();
	await expect(settingsDialog(page)).toBeVisible();

	await page.keyboard.press("Escape");
	await expectSection(page, "text");
	await page.keyboard.press("Escape");
	await expect(settingsDialog(page)).toBeHidden();
	await expect(opener).toBeFocused();
});

test("content scroll starts at the top in every section", async ({ page }) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "providers");
	const scroller = page.getByTestId("settings-scroller");
	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

	await tab(page, "providers").focus();
	await page.keyboard.press("ArrowDown");
	await expect(tab(page, "providers")).toHaveAttribute("data-active", "false");
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
	await page.keyboard.press("ArrowUp");
	await expect(tab(page, "providers")).toHaveAttribute("data-active", "true");
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
});

test("Ctrl+, toggles Settings from inside it, and Ctrl+W closes it at once from a field, keeping the edit", async ({
	page,
}) => {
	await windowsShortcuts(page);
	await openFixtureProject(page);
	const dialog = settingsDialog(page);
	await page.getByTestId("open-settings").focus();

	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeVisible();
	await tab(page, "text").click();
	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeHidden();
	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeVisible();
	await expectSection(page, "text");

	const input = page.getByTestId("chat-line-width-input");
	const saved = await input.inputValue();
	const edited = String(Number(saved) + 3);
	await input.fill(edited);
	await page.keyboard.press("Control+w");
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("open-settings")).toBeFocused();

	await page.keyboard.press("Control+Comma");
	await expect(input).toHaveValue(edited);
	await input.fill(saved);
	await page.keyboard.press("Enter");
	await tab(page, "text").focus();
	await page.keyboard.press("Control+w");
	await expect(dialog).toBeHidden();
	await page.keyboard.press("Control+Comma");
	await expect(input).toHaveValue(saved);
	await closeSettings(page);
});
