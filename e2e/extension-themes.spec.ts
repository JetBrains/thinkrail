import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_EXTENSIONS_DIR } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";

const GROUP = "extension-themes";
const EXTENSION = "themes";
const BUILT_IN_DARK_BACKGROUND = "#09090b";

const rootVar = (page: Page, name: string) =>
	page.evaluate(
		(token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
		name,
	);

const expectRootVar = (page: Page, name: string, value: string) =>
	expect.poll(() => rootVar(page, name)).toBe(value);

const overlayOf = (page: Page) =>
	page.evaluate(() => document.documentElement.dataset.themeOverlay ?? null);

const setEmberBackground = (value: string) => {
	const path = join(E2E_EXTENSIONS_DIR, EXTENSION, "extension.json");
	const manifest = JSON.parse(readFileSync(path, "utf8")) as {
		themes: { id: string; tokens: Record<string, string> }[];
	};
	const ember = manifest.themes.find((theme) => theme.id === "ember");
	if (ember) ember.tokens["--background"] = value;
	writeFileSync(path, JSON.stringify(manifest));
};

const settled = (page: Page) =>
	page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((animation) => animation instanceof CSSTransition)
				.map((animation) => animation.finished.catch(() => undefined)),
		),
	);

const pickTheme = async (page: Page, id: string) => {
	await page.getByTestId("ext-menu").first().click();
	await expect(page.getByTestId("ext-menu-themes")).toBeVisible();
	await page.getByTestId(id).click();
};

test.use({ viewport: { width: 1600, height: 1000 } });

test.afterEach(async () => {
	await removeExtension(EXTENSION);
});

test("an extension theme applies live, persists across reload, and falls back on unload", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expectRootVar(page, "--background", BUILT_IN_DARK_BACKGROUND);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	await page.getByTestId("ext-menu").first().click();
	await expect(page.getByTestId("ext-theme-builtin")).toHaveAttribute("data-state", "checked");
	await shot(page.getByRole("menu"), GROUP, "12-themes-menu");
	await page.getByTestId("ext-theme-themes-ember").click();
	await expectRootVar(page, "--background", "#fbf5ec");
	await expect.poll(() => overlayOf(page)).toBe("themes/ember");
	await expect(page.locator("html")).toHaveAttribute("data-theme-appearance", "light");
	await expect(page.locator("link[data-ext-theme]")).toHaveAttribute(
		"href",
		/\/ext\/themes\/[0-9a-f]{16}\/ember\.theme\.css/,
	);
	await expect
		.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).accentColor))
		.not.toBe("auto");
	await settled(page);
	await shot(page, GROUP, "12-themes-ember");

	setEmberBackground("#fff4e0");
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await expectRootVar(page, "--background", "#fff4e0");

	await page.reload();
	await expectRootVar(page, "--background", "#fff4e0");
	await expect.poll(() => overlayOf(page)).toBe("themes/ember");

	await pickTheme(page, "ext-theme-themes-night-contrast");
	await expectRootVar(page, "--background", "#000000");
	await expect(page.locator("html")).toHaveAttribute("data-theme-appearance", "dark");
	await expect(page.locator("link[data-ext-theme]")).toHaveCount(0);
	await settled(page);
	await shot(page, GROUP, "12-themes-night-contrast");

	await pickTheme(page, "ext-theme-themes-soft");
	await expectRootVar(page, "--radius-lg", "16px");
	await expectRootVar(page, "--accent", "#b69cff");
	await settled(page);
	await shot(page, GROUP, "12-themes-soft");

	await pickTheme(page, "ext-theme-builtin");
	await expectRootVar(page, "--background", BUILT_IN_DARK_BACKGROUND);
	await expectRootVar(page, "--radius-lg", "8px");
	await expect.poll(() => overlayOf(page)).toBeNull();

	setEmberBackground("#2b2118");
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await pickTheme(page, "ext-theme-themes-ember");
	await expect(page.getByText(/Theme themes\/ember was not applied/)).toBeVisible();
	await expectRootVar(page, "--background", BUILT_IN_DARK_BACKGROUND);
	await page.getByTestId("ext-menu").first().click();
	await expect(page.getByTestId("ext-theme-builtin")).toHaveAttribute("data-state", "checked");
	await page.keyboard.press("Escape");

	setEmberBackground("#fff4e0");
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await pickTheme(page, "ext-theme-themes-ember");
	await expectRootVar(page, "--background", "#fff4e0");
	await removeExtension(EXTENSION);
	await expectRootVar(page, "--background", BUILT_IN_DARK_BACKGROUND);
	await expect.poll(() => overlayOf(page)).toBeNull();
	await page.reload();
	await expect(page.getByTestId("ext-menu").first()).toBeVisible();
	await expectRootVar(page, "--background", BUILT_IN_DARK_BACKGROUND);
	await expect.poll(() => overlayOf(page)).toBeNull();
});

test.describe("studio", () => {
	test.use({ viewport: { width: 1600, height: 1400 } });

	test("the theme studio previews tokens live, refuses unreadable text, and exports JSON", async ({
		page,
		context,
	}) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		installRepoExtension(EXTENSION);
		expect((await reloadExtension(EXTENSION)).status).toBe("active");
		await pickTheme(page, "ext-theme-themes-soft");
		await expectRootVar(page, "--accent", "#b69cff");

		await page.getByTestId("ext-menu").first().click();
		await page.getByTestId(`ext-open-${EXTENSION}-studio`).click();
		const studio = page.getByTestId("theme-studio");
		await expect(studio).toBeVisible();
		await expect(studio.getByTestId("theme-studio-use-soft")).toHaveText("In use");
		const expandedFold = page.locator('[data-testid="side-group-fold"][aria-expanded="true"]');
		await expandedFold.first().click();
		await expandedFold.first().click();

		await studio.getByTestId("theme-studio-edit-ember").click();
		await expectRootVar(page, "--background", "#fbf5ec");
		await studio.getByTestId("theme-studio-color-accent").fill("#0f766e");
		await expectRootVar(page, "--accent", "#0f766e");
		await expectRootVar(page, "--accent-solid", "#0f766e");
		await studio.getByTestId("theme-studio-radius").fill("10");
		await expectRootVar(page, "--radius-sm", "10px");
		await expectRootVar(page, "--radius-lg", "20px");
		await expect(studio.getByTestId("theme-studio-previewing")).toBeVisible();
		await studio.getByTestId("theme-studio-title").fill("Teal paper");
		await expect(studio.getByTestId("theme-studio-snippet")).toContainText('"id": "teal-paper"');
		await expect(studio.getByTestId("theme-studio-snippet")).toContainText('"--accent": "#0f766e"');
		await studio.getByTestId("theme-studio-body").evaluate((body) => {
			body.scrollTop = 0;
		});
		await settled(page);
		await shot(page, GROUP, "12-themes-studio");
		await shot(studio, GROUP, "12-themes-studio-panel");

		await studio.getByTestId("theme-studio-copy").click();
		await expect(studio.getByTestId("theme-studio-copy")).toHaveText("Copied");
		const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
			id: string;
			mode: string;
			tokens: Record<string, string>;
		};
		expect(copied).toMatchObject({ id: "teal-paper", mode: "light" });
		expect(copied.tokens["--radius-md"]).toBe("15px");

		await studio.getByTestId("theme-studio-color-text").fill("#fbf5ec");
		await expect(studio.getByTestId("theme-studio-error")).toContainText("text contrast");
		await expect(studio.getByTestId("theme-studio-previewing")).toBeHidden();
		await expectRootVar(page, "--accent", "#b69cff");
		await expect.poll(() => overlayOf(page)).toBe("themes/soft");

		await studio.getByTestId("theme-studio-color-text").fill("#1d1f2b");
		await expectRootVar(page, "--text", "#1d1f2b");
		await studio.getByTestId("theme-studio-stop").click();
		await expectRootVar(page, "--accent", "#b69cff");
		await expectRootVar(page, "--text", "#e6e8f2");
		await expect.poll(() => overlayOf(page)).toBe("themes/soft");
	});
});
