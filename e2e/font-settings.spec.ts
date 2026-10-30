import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expandDisclosure } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_INSTALLED_FONTS } from "./fixtures/paths";

const FONTS_DIR = join(E2E_DATA_DIR, "fonts");
const ORBITRON = join(
	dirname(fileURLToPath(import.meta.url)),
	"../apps/web/node_modules/@fontsource-variable/orbitron/files/orbitron-latin-wght-normal.woff2",
);

const BUN_STORE = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/.bun");
// A static face with Latin glyphs and a single weight, already installed with mermaid's KaTeX.
const STATIC_FACE = join(
	BUN_STORE,
	readdirSync(BUN_STORE).find((entry) => entry.startsWith("katex@")) ?? "katex-missing",
	"node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf",
);

const rootToken = (page: Page, token: string) =>
	page.evaluate((name) => document.documentElement.style.getPropertyValue(name), token);

async function openFonts(page: Page): Promise<Locator> {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog.getByTestId("settings-fonts")).toBeVisible();
	return dialog;
}

async function connect(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
}

/** Every changed font row offers a reset; clicking them all returns the host to the defaults. */
async function resetFonts(page: Page): Promise<void> {
	if (page.isClosed()) return;
	const dialog = await openFonts(page);
	const fonts = dialog.getByTestId("settings-fonts");
	const resets = fonts.getByRole("button", { name: "Reset to default" });
	while ((await resets.count()) > 0) {
		const before = await resets.count();
		await resets.first().click();
		await expect(resets).toHaveCount(before - 1);
	}
	const toggle = dialog.getByTestId("font-advanced-toggle");
	await expandDisclosure(toggle);
	const removals = fonts.getByRole("button", { name: /^Remove / });
	while ((await removals.count()) > 0) {
		const before = await removals.count();
		await removals.first().click();
		await expect(removals).toHaveCount(before - 1);
	}
	await expect.poll(() => rootToken(page, "--tr-font-family-code")).toBe("");
}

test.afterEach(async ({ page }) => {
	await resetFonts(page);
	writeFileSync(E2E_INSTALLED_FONTS, "[]");
	rmSync(FONTS_DIR, { recursive: true, force: true });
});

test("font settings write the typography tokens, reach every window, and survive a reload", async ({
	page,
}) => {
	await connect(page);
	const other = await page.context().newPage();
	await connect(other);
	const dialog = await openFonts(page);
	const preview = dialog.getByTestId("font-preview");
	expect(await rootToken(page, "--tr-font-size-code")).toBe("");

	const size = dialog.getByTestId("font-code-size-input");
	await dialog.getByRole("button", { name: "Larger" }).click();
	await expect(size).toHaveValue("14");
	await dialog.getByRole("button", { name: "Larger" }).click();
	await expect(size).toHaveValue("15");
	await expect.poll(() => rootToken(page, "--tr-font-size-code")).toBe("15px");
	await expect(preview.locator("pre").first()).toHaveCSS("font-size", "15px");
	await expect.poll(() => rootToken(other, "--tr-font-size-code")).toBe("15px");

	await dialog.getByTestId("font-ligatures").click();
	await expect.poll(() => rootToken(page, "--tr-font-ligatures-code")).toBe("normal");
	await expect(preview.locator("pre").first()).toHaveCSS("font-variant-ligatures", "normal");

	const slider = dialog.getByTestId("font-weight-input");
	await slider.focus();
	await slider.press("ArrowRight");
	await expect(dialog.getByTestId("font-weight-value")).toHaveText("+10");
	await slider.press("ArrowRight");
	await expect(dialog.getByTestId("font-weight-value")).toHaveText("+20");
	await expect.poll(() => rootToken(page, "--tr-font-weight-offset")).toBe("20");
	await expect.poll(() => rootToken(other, "--tr-font-weight-offset")).toBe("20");

	await dialog.getByTestId("font-interface-trigger").click();
	await page
		.locator('[data-testid="font-interface-option"][data-font-family="JetBrains Mono Variable"]')
		.click();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-interface"))
		.toBe('"JetBrains Mono Variable", var(--tr-font-family-interface-default)');

	await dialog.getByTestId("font-code-trigger").click();
	await page.getByTestId("font-code-search").fill("Operator Mono");
	await page.getByTestId("font-code-typed").click();
	await expect(dialog.getByTestId("font-code-unavailable")).toContainText(
		"Operator Mono isn't available on this device",
	);
	await expect(dialog.getByTestId("font-code-trigger")).toHaveAttribute(
		"data-font-family",
		"Operator Mono",
	);

	await other.close();
	await page.reload();
	await expect.poll(() => rootToken(page, "--tr-font-size-code")).toBe("15px");
	await expect
		.poll(() => rootToken(page, "--tr-font-family-code"))
		.toBe('"Operator Mono", var(--tr-font-family-code-default)');
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	const reopened = await openFonts(page);
	await expect(reopened.getByTestId("font-code-size-input")).toHaveValue("15");
	await expect(reopened.getByTestId("font-ligatures")).toHaveAttribute("data-active", "true");
});

test("a font file added in Settings lands in the fonts folder, joins the lists, and applies", async ({
	page,
}) => {
	await connect(page);
	const dialog = await openFonts(page);
	await dialog.getByTestId("custom-fonts-input").setInputFiles([
		{ name: "Orbitron.woff2", mimeType: "font/woff2", buffer: readFileSync(ORBITRON) },
		{ name: "Collection.ttc", mimeType: "font/collection", buffer: Buffer.from("ttcf") },
		{ name: "Broken.otf", mimeType: "font/otf", buffer: Buffer.from("not a font") },
	]);
	await expect(dialog.getByTestId("custom-fonts-added")).toContainText("Orbitron");
	await expect(dialog.getByTestId("custom-font-issue-Collection.ttc")).toContainText(
		"Font collections (.ttc) aren't supported",
	);
	await expect(dialog.getByTestId("custom-font-issue-Broken.otf")).toContainText(
		"This file isn't a valid font",
	);
	const family = dialog.locator('[data-testid="custom-font-family"][data-font-family="Orbitron"]');
	await expect(family).toBeVisible();
	expect(existsSync(join(FONTS_DIR, "Orbitron.woff2"))).toBe(true);
	expect(existsSync(join(FONTS_DIR, "Collection.ttc"))).toBe(false);
	expect(existsSync(join(FONTS_DIR, "Broken.otf"))).toBe(false);

	await dialog.getByTestId("font-interface-trigger").click();
	await page.locator('[data-testid="font-interface-option"][data-font-family="Orbitron"]').click();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-interface"))
		.toBe('"Orbitron", var(--tr-font-family-interface-default)');
	await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Orbitron"'))).toBe(true);
	await expect(family).toContainText("In use");

	rmSync(join(FONTS_DIR, "Orbitron.woff2"));
	await expect(family).toHaveCount(0);
	await expect(dialog.getByTestId("font-interface-unavailable")).toBeVisible();
});

test("the installed list comes from the host's font service, and a failed read offers retry", async ({
	page,
}) => {
	writeFileSync(E2E_INSTALLED_FONTS, JSON.stringify({ error: "fc-list is not installed" }));
	await connect(page);
	const dialog = await openFonts(page);
	await expandDisclosure(dialog.getByTestId("font-advanced-toggle"));
	await dialog.getByTestId("font-code-fallbacks-add").click();
	await expect(page.getByTestId("font-installed-failed")).toBeVisible();

	writeFileSync(
		E2E_INSTALLED_FONTS,
		JSON.stringify([{ name: "Fixture Symbols", monospaceHint: true }]),
	);
	await page.getByTestId("font-installed-failed").getByRole("button", { name: "Retry" }).click();
	await page
		.locator('[data-testid="font-code-fallbacks-option"][data-font-family="Fixture Symbols"]')
		.click();
	await expect(
		dialog.locator('[data-testid="font-code-fallbacks-chip"][data-font-family="Fixture Symbols"]'),
	).toBeVisible();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-code"))
		.toBe('"JetBrains Mono Variable", "Fixture Symbols", var(--tr-font-family-code-default)');
});

test("the weight slider says so when the chosen font has no weights to move between", async ({
	page,
}) => {
	await connect(page);
	const dialog = await openFonts(page);
	await expect(dialog.getByTestId("font-weight-hint")).toHaveCount(0);
	await dialog
		.getByTestId("custom-fonts-input")
		.setInputFiles([
			{ name: "KaTeX_Main-Regular.ttf", mimeType: "font/ttf", buffer: readFileSync(STATIC_FACE) },
		]);
	await expect(dialog.getByTestId("custom-fonts-added")).toContainText("KaTeX_Main");
	await dialog.getByTestId("font-interface-trigger").click();
	await page
		.locator('[data-testid="font-interface-option"][data-font-family="KaTeX_Main"]')
		.click();
	await expect(dialog.getByTestId("font-weight-hint")).toContainText(
		"KaTeX_Main has no weights between regular and bold",
	);

	await dialog.getByRole("button", { name: "Reset to default" }).first().click();
	await expect(dialog.getByTestId("font-weight-hint")).toHaveCount(0);
});
