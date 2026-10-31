import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	type AppConfigUpdate,
	DEFAULT_CONFIG,
	normalizeFontSettings,
	SPLIT_FONT_SIZES_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import {
	createWorkspaceViaDialog,
	expandDisclosure,
	hideAuxiliaryWorkbench,
	openFixtureProject,
	PHONE_VIEWPORT,
	revealWorkbenchTool,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";
import { fixtureFont } from "./fixtures/fonts";
import { E2E_DATA_DIR, E2E_INSTALLED_FONTS } from "./fixtures/paths";
import { pierreLines, selectPierreLine } from "./fixtures/pierre";
import { shot } from "./fixtures/screenshots";
import { CODE_FACE } from "./fixtures/typography";
import { E2eWire } from "./fixtures/wire";

const FONTS_DIR = join(E2E_DATA_DIR, "fonts");
const FIXTURE_FAMILY = "ThinkRail Fixture Sans";
const FIXTURE_FILE = {
	name: "ThinkRailFixture-Regular.ttf",
	mimeType: "font/ttf",
	buffer: fixtureFont(FIXTURE_FAMILY),
};
const ABSENT_FAMILY = "ThinkRail Absent Mono";
const FONT_TOKENS = [
	"--tr-font-family-interface",
	"--tr-font-family-code",
	"--tr-font-size-code",
	"--tr-font-size-terminal",
	"--tr-font-weight-offset",
	"--tr-font-ligatures-code",
];

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

async function updateHostSettings(baseURL: string | undefined, config: AppConfigUpdate) {
	if (!baseURL) throw new Error("Font settings fixtures require the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		await wire.request("settings.update", { config });
	} finally {
		wire.close();
	}
}

test.afterEach(async ({ baseURL }) => {
	try {
		await updateHostSettings(baseURL, normalizeFontSettings(DEFAULT_CONFIG));
	} finally {
		writeFileSync(E2E_INSTALLED_FONTS, "[]");
		rmSync(FONTS_DIR, { recursive: true, force: true });
	}
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
	await dialog.getByRole("button", { name: "Increase Code size" }).click();
	await expect(size).toHaveValue("12");
	await dialog.getByRole("button", { name: "Increase Code size" }).click();
	await expect(size).toHaveValue("13");
	await expect.poll(() => rootToken(page, "--tr-font-size-code")).toBe("13px");
	await expect(preview.locator("pre").first()).toHaveCSS("font-size", "15px");
	await expect.poll(() => rootToken(other, "--tr-font-size-code")).toBe("13px");

	const terminalSize = dialog.getByTestId("font-terminal-size-input");
	await terminalSize.fill("20");
	await terminalSize.press("Enter");
	await expect.poll(() => rootToken(other, "--tr-font-size-terminal")).toBe("20px");
	await expect(preview.locator(".tr-code-editor")).toHaveCSS("font-size", "13px");
	await expect(preview.locator(".tr-code-terminal")).toHaveCSS("font-size", "20px");
	await expect(preview.locator("pre").first()).toHaveCSS("font-size", "15px");
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
		.locator(`[data-testid="font-interface-option"][data-font-family="${CODE_FACE}"]`)
		.click();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-interface"))
		.toBe(`"${CODE_FACE}", var(--tr-font-family-interface-default)`);

	await dialog.getByTestId("font-code-trigger").click();
	await page.getByTestId("font-code-search").fill(ABSENT_FAMILY);
	await page.getByTestId("font-code-typed").click();
	await expect(dialog.getByTestId("font-code-unavailable")).toContainText(
		`${ABSENT_FAMILY} isn't available on this device`,
	);
	await expect(dialog.getByTestId("font-code-trigger")).toHaveAttribute(
		"data-font-family",
		ABSENT_FAMILY,
	);

	await other.close();
	await page.reload();
	await expect.poll(() => rootToken(page, "--tr-font-size-code")).toBe("13px");
	await expect
		.poll(() => rootToken(page, "--tr-font-family-code"))
		.toBe(`"${ABSENT_FAMILY}", var(--tr-font-family-code-default)`);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	const reopened = await openFonts(page);
	await expect(reopened.getByTestId("font-terminal-size-input")).toHaveValue("20");
	await expect(reopened.getByTestId("font-code-size-input")).toHaveValue("13");
	await expect(reopened.getByTestId("font-ligatures")).toHaveAttribute("data-active", "true");

	const resets = reopened
		.getByTestId("settings-fonts")
		.getByRole("button", { name: /^Reset .+ to default$/ });
	await expect(resets).toHaveCount(6);
	while ((await resets.count()) > 0) {
		const before = await resets.count();
		await resets.first().click();
		await expect(resets).toHaveCount(before - 1);
	}
	for (const token of FONT_TOKENS) await expect.poll(() => rootToken(page, token)).toBe("");
});

test("a font file added in Settings lands in the fonts folder, joins the lists, and applies", async ({
	page,
}) => {
	await connect(page);
	const dialog = await openFonts(page);
	await dialog
		.getByTestId("custom-fonts-input")
		.setInputFiles([
			FIXTURE_FILE,
			{ name: "Collection.ttc", mimeType: "font/collection", buffer: Buffer.from("ttcf") },
			{ name: "Broken.otf", mimeType: "font/otf", buffer: Buffer.from("not a font") },
		]);
	await expect(dialog.getByTestId("custom-fonts-added")).toContainText(FIXTURE_FAMILY);
	await expect(dialog.getByTestId("custom-font-issue-Collection.ttc")).toContainText(
		"Font collections (.ttc) aren't supported",
	);
	await expect(dialog.getByTestId("custom-font-issue-Broken.otf")).toContainText(
		"This file isn't a valid font",
	);
	const family = dialog.locator(
		`[data-testid="custom-font-family"][data-font-family="${FIXTURE_FAMILY}"]`,
	);
	await expect(family).toBeVisible();
	expect(existsSync(join(FONTS_DIR, FIXTURE_FILE.name))).toBe(true);
	expect(existsSync(join(FONTS_DIR, "Collection.ttc"))).toBe(false);
	expect(existsSync(join(FONTS_DIR, "Broken.otf"))).toBe(false);

	await dialog.getByTestId("font-interface-trigger").click();
	await page
		.locator(`[data-testid="font-interface-option"][data-font-family="${FIXTURE_FAMILY}"]`)
		.click();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-interface"))
		.toBe(`"${FIXTURE_FAMILY}", var(--tr-font-family-interface-default)`);
	await expect
		.poll(() => page.evaluate((name) => document.fonts.check(`16px "${name}"`), FIXTURE_FAMILY))
		.toBe(true);
	await expect(family).toContainText("In use");

	rmSync(join(FONTS_DIR, FIXTURE_FILE.name));
	await expect(family).toHaveCount(0);
	await expect(dialog.getByTestId("font-interface-unavailable")).toBeVisible();
});

test("the installed list comes from the host's font service, scrolls inside the dialog, and a failed read offers retry", async ({
	page,
}) => {
	writeFileSync(E2E_INSTALLED_FONTS, JSON.stringify({ error: "fc-list is not installed" }));
	await connect(page);
	const dialog = await openFonts(page);
	await expandDisclosure(dialog.getByTestId("font-advanced-toggle"));
	await dialog.getByTestId("font-code-fallbacks-add").click();
	await expect(page.getByTestId("font-installed-failed")).toBeVisible();

	const fillers = Array.from({ length: 40 }, (_, index) => ({
		name: `Fixture Filler ${String(index).padStart(2, "0")}`,
		monospaceHint: false,
	}));
	writeFileSync(
		E2E_INSTALLED_FONTS,
		JSON.stringify([{ name: "Fixture Symbols", monospaceHint: true }, ...fillers]),
	);
	await page.getByTestId("font-installed-failed").getByRole("button", { name: "Retry" }).click();
	const list = page.getByTestId("font-code-fallbacks-list");
	await expect(list.getByText("Fixture Filler 39")).toBeAttached();
	await list.hover();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await page
		.locator('[data-testid="font-code-fallbacks-option"][data-font-family="Fixture Symbols"]')
		.click();
	await expect(
		dialog.locator('[data-testid="font-code-fallbacks-chip"][data-font-family="Fixture Symbols"]'),
	).toBeVisible();
	await expect
		.poll(() => rootToken(page, "--tr-font-family-code"))
		.toBe(`"${CODE_FACE}", "Fixture Symbols", var(--tr-font-family-code-default)`);

	await dialog.getByRole("button", { name: "Remove Fixture Symbols" }).click();
	await expect.poll(() => rootToken(page, "--tr-font-family-code")).toBe("");
});

test("the weight slider says so when the chosen font has no weights to move between", async ({
	page,
}) => {
	await connect(page);
	const dialog = await openFonts(page);
	await expect(dialog.getByTestId("font-weight-hint")).toHaveCount(0);
	await dialog.getByTestId("custom-fonts-input").setInputFiles([FIXTURE_FILE]);
	await expect(dialog.getByTestId("custom-fonts-added")).toContainText(FIXTURE_FAMILY);
	await dialog.getByTestId("font-interface-trigger").click();
	await page
		.locator(`[data-testid="font-interface-option"][data-font-family="${FIXTURE_FAMILY}"]`)
		.click();
	await expect(dialog.getByTestId("font-weight-hint")).toContainText(
		`${FIXTURE_FAMILY} has no weights between regular and bold`,
	);

	await dialog.getByRole("button", { name: "Reset interface font to default" }).click();
	await expect(dialog.getByTestId("font-weight-hint")).toHaveCount(0);
});

test("a code size change re-measures an open Pierre file and keeps the comment being written", async ({
	page,
	baseURL,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await page.setViewportSize(PHONE_VIEWPORT);
	await hideAuxiliaryWorkbench(page);
	const fileView = page.getByTestId("file-view");
	const line = pierreLines(fileView, "plain-text-fixture");
	await expect(line).toHaveCount(1);
	const rowHeight = () => line.evaluate((element) => element.getBoundingClientRect().height);
	const before = await rowHeight();

	await selectPierreLine(fileView, "plain-text-fixture");
	const input = page.getByTestId("review-composer-input");
	await input.fill("Kept across a font change.");
	await updateHostSettings(baseURL, { terminalFontSize: 20 });
	await expect.poll(() => rootToken(page, "--tr-font-size-terminal")).toBe("20px");
	expect(await rowHeight()).toBe(before);
	await updateHostSettings(baseURL, { codeFontSize: 18 });
	await expect.poll(rowHeight).toBeGreaterThan(before);
	await expect(input).toHaveValue("Kept across a font change.");
});

test("old hosts disable both size controls without font-size writes", async ({ page }) => {
	const writes: unknown[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString());
			if (frame.method === "settings.update") writes.push(frame.params.config);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString());
			if (frame.channel === "server.welcome") {
				frame.data.protocolVersion = SPLIT_FONT_SIZES_PROTOCOL_VERSION - 1;
				frame.data.config.codeFontSize = 15;
				delete frame.data.config.terminalFontSize;
				browser.send(JSON.stringify(frame));
			} else browser.send(message);
		});
	});
	await connect(page);
	const dialog = await openFonts(page);
	await expect(dialog.getByTestId("font-code-size-input")).toBeDisabled();
	await expect(dialog.getByTestId("font-terminal-size-input")).toBeDisabled();
	await expect(dialog.getByTestId("font-code-size-input")).toHaveValue("13");
	await expect(dialog.getByTestId("font-terminal-size-input")).toHaveValue("15");
	await expect(dialog.getByTestId("font-code-size")).toContainText("Update the host");
	await expect(dialog.getByTestId("font-preview").locator(".tr-code-editor")).toHaveCSS(
		"font-size",
		"13px",
	);
	await expect(dialog.getByTestId("font-preview").locator(".tr-code-terminal")).toHaveCSS(
		"font-size",
		"15px",
	);
	expect(writes).toEqual([]);
});

test("file and terminal sizes change independently without restarting the shell", async ({
	page,
	baseURL,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	const terminal = visibleTerminalScreen(page);
	await runInTerminal(page, "export FONT_SPLIT_MARKER=kept; echo FONT_SPLIT_BEFORE");
	await expect(terminal).toContainText("FONT_SPLIT_BEFORE");
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	const fileLine = page.locator(".monaco-editor .view-lines").first();
	await expect(fileLine).toHaveCSS("font-size", "11px");
	await expect(terminal).toHaveCSS("font-size", "13px");
	await shot(page, "split-fonts", "default-workbench");
	await updateHostSettings(baseURL, { codeFontSize: 16 });
	await expect(fileLine).toHaveCSS("font-size", "16px");
	await expect(terminal).toHaveCSS("font-size", "13px");
	await updateHostSettings(baseURL, { terminalFontSize: 20 });
	await expect(terminal).toHaveCSS("font-size", "20px");
	await expect(fileLine).toHaveCSS("font-size", "16px");
	await expect(terminal).toContainText("FONT_SPLIT_BEFORE");
	await runInTerminal(page, "echo FONT_SPLIT_AFTER_$FONT_SPLIT_MARKER");
	await expect(terminal).toContainText("FONT_SPLIT_AFTER_kept");
	await shot(page, "split-fonts", "changed-workbench");
	const dialog = await openFonts(page);
	await dialog.getByTestId("font-terminal-size-input").scrollIntoViewIfNeeded();
	await shot(dialog, "split-fonts", "appearance");
	await expect(dialog.getByTestId("font-preview").locator("pre").first()).toHaveCSS(
		"font-size",
		"18px",
	);
	await dialog.getByRole("button", { name: "Reset code size to default" }).click();
	await expect(dialog.getByTestId("font-code-size-input")).toHaveValue("11");
	await expect(dialog.getByTestId("font-terminal-size-input")).toHaveValue("20");
	const code = dialog.getByTestId("font-code-size-input");
	await code.fill("99");
	await expect(dialog.getByTestId("font-code-size")).toContainText(
		"Enter a whole number from 8 to 22",
	);
	await code.press("Escape");
	await expect(code).toHaveValue("11");
	await dialog.getByRole("button", { name: "Reset terminal size to default" }).click();
	await expect(dialog.getByTestId("font-terminal-size-input")).toHaveValue("13");
	await page.setViewportSize(PHONE_VIEWPORT);
	await code.fill("22");
	await code.press("Enter");
	const terminalInput = dialog.getByTestId("font-terminal-size-input");
	await terminalInput.fill("24");
	await terminalInput.press("Enter");
	await expect.poll(() => rootToken(page, "--tr-font-size-terminal")).toBe("24px");
	await expect.poll(() => rootToken(page, "--tr-font-size-code")).toBe("22px");
	for (const input of [code, terminalInput]) {
		await input.scrollIntoViewIfNeeded();
		const bounds = await input.boundingBox();
		expect(bounds).not.toBeNull();
		if (bounds) {
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(PHONE_VIEWPORT.width);
		}
	}
	await shot(dialog, "split-fonts", "appearance-mobile");
});
