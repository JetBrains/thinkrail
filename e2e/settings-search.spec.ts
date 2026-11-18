import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
	settingsDialog,
} from "./fixtures/app";

const tab = (page: Page, id: string) => page.getByTestId(`settings-nav-${id}`);
const field = (page: Page) => page.getByTestId("settings-search");
const results = (page: Page) => page.getByTestId("settings-search-result");
const result = (page: Page, id: string) =>
	page.locator(`[data-testid="settings-search-result"][data-result-id="${id}"]`);
const settingRow = (page: Page, id: string) =>
	settingsDialog(page).locator(`#settings-panel [data-setting-id="${id}"]`);
const focusInside = (page: Page, id: string) =>
	settingRow(page, id)
		.first()
		.evaluate((row) => row.contains(document.activeElement));

interface CatalogEntry {
	readonly id: string;
	readonly section: string;
	readonly label: string;
}

function catalogEntries(): CatalogEntry[] {
	const source = readFileSync(
		new URL("../apps/web/src/panels/settingsCatalog.ts", import.meta.url),
		"utf8",
	);
	const english = JSON.parse(
		readFileSync(new URL("../packages/locales/en.json", import.meta.url), "utf8"),
	) as Record<string, string>;
	const entries = [
		...source.matchAll(
			/\bid: "([a-z0-9-]+)",\s+section: SettingsSection\.(\w+),\s+label: "([^"]+)"/g,
		),
	].map(([, id = "", section = "", key = ""]) => ({ id, section, label: english[key] ?? key }));
	const declared = source.match(/^\t\tid: "/gm)?.length ?? 0;
	expect(entries.length, "every catalog entry is read").toBe(declared);
	return entries;
}

const NOT_OFFERED_HERE: Readonly<Record<string, string>> = {
	"software-updates": "Updates is injected only by the desktop app",
	"windows-shell": "the Windows shell is offered only on a Windows host",
};

test("S and / start a search from the nav, other letters do nothing, and F starts hint mode", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "chat");

	await page.keyboard.press("s");
	await expect(field(page)).toBeFocused();
	await expect(field(page)).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(tab(page, "chat")).toBeFocused();

	await page.keyboard.press("/");
	await expect(field(page)).toBeFocused();
	await expect(field(page)).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(tab(page, "chat")).toBeFocused();

	for (const letter of ["x", "a", "q"]) await page.keyboard.press(letter);
	await expect(tab(page, "chat")).toBeFocused();
	await expect(tab(page, "chat")).toHaveAttribute("data-active", "true");
	await expect(field(page)).toHaveValue("");

	await page.keyboard.press("f");
	await expect(page.getByTestId("hint-mode")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("hint-mode")).toHaveCount(0);
	await expect(settingsDialog(page)).toBeVisible();
});

test("results name their section; ↓ walks in, Enter jumps and flashes with the query kept, and Esc walks back out", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "privacy");
	await page.keyboard.press("s");
	await page.keyboard.type("message order");

	const list = page.getByTestId("settings-search-results");
	await expect(list.getByRole("heading")).toHaveText(/^\d+ results?$/);
	await expect(list).toContainText("for “message order” in all sections");
	const hit = result(page, "message-order");
	await expect(results(page).first()).toHaveAttribute("data-result-id", "message-order");
	await expect(hit).toContainText("Chat");
	await expect(hit.locator("mark").first()).toBeVisible();
	await expect(tab(page, "privacy")).toHaveAttribute("data-active", "true");

	await page.keyboard.press("ArrowDown");
	await expect(hit).toBeFocused();
	await expect(hit).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Enter");
	await expect(tab(page, "chat")).toHaveAttribute("data-active", "true");
	await expect(settingRow(page, "message-order")).toHaveAttribute("data-setting-flash", "");
	await expect.poll(() => focusInside(page, "message-order")).toBe(true);
	await expect(field(page)).toHaveValue("message order");
	await expect(list).toHaveCount(0);

	await page.keyboard.press("Escape");
	await expect(hit).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(field(page)).toHaveValue("");
	await expect(field(page)).toBeFocused();
	await expect(list).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(tab(page, "chat")).toBeFocused();
	await expect(settingsDialog(page)).toBeVisible();
});

test("j/k walk the results, ↑ on the first goes back to the field, and Enter in the field jumps to the first", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "chat");
	await page.keyboard.press("/");
	await page.keyboard.type("width");
	await expect(results(page).nth(1)).toBeVisible();

	await page.keyboard.press("ArrowDown");
	await expect(results(page).first()).toBeFocused();
	await page.keyboard.press("j");
	await expect(results(page).nth(1)).toBeFocused();
	await page.keyboard.press("k");
	await expect(results(page).first()).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(field(page)).toBeFocused();

	const first = await results(page).first().getAttribute("data-result-id");
	await page.keyboard.press("Enter");
	await expect(settingRow(page, first ?? "")).toHaveAttribute("data-setting-flash", "");
	await expect(field(page)).toHaveValue("width");
});

test("the palette offers a row per setting that opens Settings on it", async ({ page }) => {
	await openFixtureProject(page);
	await pressPlatformShortcut(page, "k");
	await page.getByTestId("search-input").fill(">message order");
	const row = page.locator('[data-testid="search-row"][data-item-id="setting:message-order"]');
	await expect(row).toBeVisible();
	await expect(row).toContainText("Settings › Chat");
	await row.click();
	await expect(settingsDialog(page)).toBeVisible();
	await expect(tab(page, "chat")).toHaveAttribute("data-active", "true");
	await expect(settingRow(page, "message-order")).toHaveAttribute("data-setting-flash", "");
	await expect.poll(() => focusInside(page, "message-order")).toBe(true);
});

test("drift check: every catalog entry the search offers jumps to its rendered row", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openSettingsSection(page, "appearance");

	const missing: string[] = [];
	const hidden: string[] = [];
	const list = page.getByTestId("settings-search-results");
	for (const entry of catalogEntries()) {
		await field(page).fill(entry.label);
		await expect(list).toContainText(`“${entry.label.trim()}”`);
		const hit = result(page, entry.id);
		if ((await hit.count()) === 0) {
			if (!(entry.id in NOT_OFFERED_HERE)) hidden.push(`${entry.id} (“${entry.label}”)`);
			continue;
		}
		await hit.click();
		await expect(list).toHaveCount(0);
		try {
			await expect(settingRow(page, entry.id).first()).toBeAttached({ timeout: 3_000 });
		} catch {
			missing.push(`${entry.section}: ${entry.id}`);
		}
	}
	expect(hidden, "catalog entries the search does not offer").toEqual([]);
	expect(missing, "catalog entries with no rendered [data-setting-id]").toEqual([]);
});
