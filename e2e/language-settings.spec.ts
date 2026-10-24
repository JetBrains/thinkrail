import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const LOCALES_DIR = join(E2E_DATA_DIR, "locales");

function writeLocale(name: string, content: string): void {
	mkdirSync(LOCALES_DIR, { recursive: true });
	writeFileSync(join(LOCALES_DIR, name), content);
}

function removeLocale(name: string): void {
	rmSync(join(LOCALES_DIR, name), { force: true });
}

async function openLanguageSettings(page: Page) {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	await page.getByTestId("settings-nav-language").click();
	const section = page.getByTestId("settings-language");
	await expect(section).toBeVisible();
	return section;
}

test.afterEach(async ({ page }) => {
	for (const name of ["de.json", "fr.json"]) removeLocale(name);
	if (page.isClosed()) return;
	const section = await openLanguageSettings(page);
	const system = section.getByTestId("language-system");
	if ((await system.getAttribute("data-active")) !== "true") await system.click();
	await expect(system).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("a local language file is listed, selectable, live-reloaded, and survives deletion", async ({
	page,
}) => {
	writeLocale(
		"de.json",
		JSON.stringify({ "settings.language.title": "Sprache", "settings.nav.language": "Sprache" }),
	);
	await openFixtureProject(page);
	const section = await openLanguageSettings(page);

	const german = section.getByTestId("language-de");
	await expect(german).toContainText("Deutsch");
	await expect(german).toContainText("Local file");
	await expect(section.getByTestId("language-en")).toContainText("Built-in");

	await german.click();
	await expect(german).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "de");
	await expect(page.getByTestId("settings-nav-language")).toContainText("Sprache");

	writeLocale(
		"de.json",
		JSON.stringify({ "settings.language.title": "Sprache", "settings.nav.language": "Sprachen" }),
	);
	await expect(page.getByTestId("settings-nav-language")).toContainText("Sprachen");

	writeLocale("fr.json", "{ not json");
	const broken = section.getByTestId("language-broken-fr.json");
	await expect(broken).toContainText("isn't valid JSON");
	await expect(broken.locator("input")).toBeDisabled();

	await page.reload();
	await openLanguageSettings(page);
	await expect(page.locator("html")).toHaveAttribute("lang", "de");

	removeLocale("de.json");
	await expect(page.getByTestId("language-missing-de")).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.getByTestId("settings-nav-language")).toContainText("Language");

	writeLocale("de.json", JSON.stringify({ "settings.nav.language": "Sprache" }));
	await expect(page.getByTestId("language-de")).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

test("switching language re-renders cached labels, markup strings and a mounted editor's controls, including live catalog edits", async ({
	page,
}) => {
	const german = (files: string) =>
		JSON.stringify({
			"workbench.tool.files": files,
			"settings.language.add.steps": "Lade <0>en.json</0> herunter und übersetze die Werte.",
			"review.widget.commentOnSelection": "Auswahl kommentieren",
		});
	writeLocale("de.json", german("Dateien"));
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const filesTool = page.getByTestId("tool-rail-files");
	await expect(filesTool).toHaveAccessibleName(/Files/);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).click();
	const commentButton = page.getByTestId("review-add-icon");
	await expect(commentButton).toHaveAttribute("title", "Comment on selection");

	const section = await openLanguageSettings(page);
	await section.getByTestId("language-de").click();
	await expect(section.getByTestId("language-add")).toContainText("Lade en.json herunter");
	await page.keyboard.press("Escape");
	await expect(filesTool).toHaveAccessibleName(/Dateien/);
	await expect(commentButton).toHaveAttribute("title", "Auswahl kommentieren");
	await expect(commentButton).toHaveAttribute("aria-label", "Auswahl kommentieren");

	writeLocale("de.json", german("Dateiliste"));
	await expect(filesTool).toHaveAccessibleName(/Dateiliste/);
	await expect(page.getByTestId("center-tabs")).toBeVisible();
});
