import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

const localCatalog = join(E2E_DATA_DIR, "locales", "zh-TW.json");

async function languageSettings(page: Page) {
	if (!(await page.getByTestId("settings-dialog").isVisible())) {
		await page.getByTestId("open-settings").click();
	}
	await page.getByTestId("settings-nav-language").click();
	const section = page.getByTestId("settings-language");
	await expect(section).toBeVisible();
	return section;
}

test.afterEach(async ({ page }) => {
	rmSync(localCatalog, { force: true });
	if (page.isClosed()) return;
	const section = await languageSettings(page);
	await section.getByTestId("language-system").click();
	await expect(section.getByTestId("language-system")).toHaveAttribute("data-active", "true");
});

test("Taiwanese Traditional Chinese is bundled, renders markup, and persists across reload", async ({
	page,
}, testInfo) => {
	rmSync(localCatalog, { force: true });
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const section = await languageSettings(page);
	const taiwan = section.getByTestId("language-zh-TW");
	await expect(taiwan).toContainText("Built-in");
	await taiwan.click();
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await expect(page.getByTestId("settings-nav-language")).toHaveText("語言");
	await expect(
		section.getByTestId("language-add").getByRole("link", { name: "en.json" }),
	).toBeVisible();
	await expect(section.getByTestId("language-add")).not.toContainText("<0>");
	await page.screenshot({
		path: testInfo.outputPath("zh-tw-language-settings.png"),
		fullPage: true,
	});

	await page.reload();
	await languageSettings(page);
	await expect(taiwan).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("tool-rail-files")).toHaveAccessibleName(/檔案/);

	await languageSettings(page);
	await section.getByTestId("language-en").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("tool-rail-files")).toHaveAccessibleName(/Files/);
});

test("a Taiwan overlay live-reloads and its removal restores the bundled translation", async ({
	page,
}) => {
	mkdirSync(join(E2E_DATA_DIR, "locales"), { recursive: true });
	writeFileSync(localCatalog, JSON.stringify({ "settings.nav.language": "測試語言" }));
	await openFixtureProject(page);
	const section = await languageSettings(page);
	await section.getByTestId("language-zh-TW").click();
	await expect(page.getByTestId("settings-nav-language")).toHaveText("測試語言");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");

	writeFileSync(localCatalog, JSON.stringify({ "settings.nav.language": "即時更新語言" }));
	await expect(page.getByTestId("settings-nav-language")).toHaveText("即時更新語言");

	rmSync(localCatalog, { force: true });
	await expect(page.getByTestId("settings-nav-language")).toHaveText("語言");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
	await expect(section.getByTestId("language-zh-TW")).toHaveAttribute("data-active", "true");
});

for (const locale of ["zh-TW", "zh-Hant-TW"]) {
	test.describe(`system locale ${locale}`, () => {
		test.use({ locale });
		test("selects the bundled Taiwan catalog without a local overlay", async ({ page }) => {
			rmSync(localCatalog, { force: true });
			await openFixtureProject(page);
			const section = await languageSettings(page);
			await section.getByTestId("language-system").click();
			await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
			await expect(page.getByTestId("settings-nav-language")).toHaveText("語言");
		});
	});
}

test.describe("Simplified Chinese system locale", () => {
	test.use({ locale: "zh-CN" });
	test("does not select the Taiwan catalog", async ({ page }) => {
		await openFixtureProject(page);
		const section = await languageSettings(page);
		await section.getByTestId("language-system").click();
		await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
		await expect(section.getByTestId("language-zh-TW")).not.toHaveAttribute("data-active", "true");
	});
});
