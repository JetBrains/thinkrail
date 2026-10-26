import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { expandDisclosure } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const THEMES_DIR = join(E2E_DATA_DIR, "themes");
const DARK = JSON.parse(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), "../apps/web/src/themes/bundled/dark.theme.json"),
		"utf8",
	),
) as { colors: Record<string, string | null> };

function writeTheme(fileName: string, id: string, background: string): void {
	mkdirSync(THEMES_DIR, { recursive: true });
	const manifest = { ...DARK, id, label: "Ocean", colors: { ...DARK.colors, background } };
	writeFileSync(join(THEMES_DIR, fileName), JSON.stringify(manifest));
}

function removeThemes(): void {
	for (const name of ["ocean.theme.json", "dark.theme.json"]) {
		rmSync(join(THEMES_DIR, name), { force: true });
	}
}

async function openThemeList(page: Page) {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await expandDisclosure(dialog.getByTestId("theme-toggle"));
	return dialog;
}

const background = (page: Page) =>
	page.evaluate(() => document.documentElement.style.getPropertyValue("--background"));

test.afterEach(() => removeThemes());

test("a theme file dropped into the themes folder is listed, applied, live-reloaded, and survives reload", async ({
	page,
}) => {
	writeTheme("ocean.theme.json", "ocean", "#001122");
	writeTheme("dark.theme.json", "dark", "#000000");
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const dialog = await openThemeList(page);
	await expect(dialog.getByTestId("custom-themes-folder-path")).toHaveText(THEMES_DIR);
	await expect(dialog.getByTestId("custom-theme-issue-dark.theme.json")).toContainText(
		"built-in theme already uses this id",
	);

	await dialog.getByTestId("theme-option-ocean").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
	expect(await background(page)).toBe("#001122");

	writeTheme("ocean.theme.json", "ocean", "#002244");
	await expect.poll(() => background(page)).toBe("#002244");

	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
	await expect.poll(() => background(page)).toBe("#002244");

	removeThemes();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	const restored = await openThemeList(page);
	await expect(restored.getByTestId("theme-option-ocean")).toHaveCount(0);
	await expect(restored.getByTestId("theme-fallback-warning")).toBeVisible();
	await restored.getByTestId("theme-option-dark").click();
	await expect(restored.getByTestId("theme-fallback-warning")).toHaveCount(0);
});
