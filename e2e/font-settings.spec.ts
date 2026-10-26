import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	revealWorkbenchTool,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";
import { CODE_FACE, INTERFACE_FACE } from "./fixtures/typography";

async function openFonts(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(page.getByTestId("font-settings")).toBeVisible();
}

async function setFont(page: Page, kind: string, name: string) {
	const input = page.getByTestId(`font-${kind}-input`);
	await input.fill(name);
	await input.press("Enter");
	await expect(input).toHaveValue(name.trim());
}

async function family(page: Page, selector: string): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate((element) => getComputedStyle(element).fontFamily);
}

test("font choices persist locally, validate names and restore defaults independently", async ({
	page,
	context,
}) => {
	await openAppFresh(page);
	const original = await family(page, "body");
	await openFonts(page);
	await setFont(page, "interface", CODE_FACE);
	await setFont(page, "code", INTERFACE_FACE);
	await setFont(page, "terminal", "Missing Test Font 987654");
	await expect.poll(() => family(page, "body")).toMatch(new RegExp(`^"?${CODE_FACE}`));
	await expect
		.poll(() => family(page, '[data-testid="font-code-preview"]'))
		.toMatch(new RegExp(`^"?${INTERFACE_FACE}`));
	await expect
		.poll(() => family(page, '[data-testid="font-terminal-preview"]'))
		.toContain("Missing Test Font 987654");
	expect(await family(page, '[data-testid="font-terminal-preview"]')).toContain(CODE_FACE);
	await page.evaluate(() => document.fonts.ready);
	const cdp = await context.newCDPSession(page);
	try {
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const { root } = await cdp.send("DOM.getDocument");
		const { nodeId } = await cdp.send("DOM.querySelector", {
			nodeId: root.nodeId,
			selector: '[data-testid="font-terminal-preview"]',
		});
		const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
		expect(
			fonts.some(
				(font) =>
					font.familyName.includes(CODE_FACE.replace(/ Variable$/, "")) && font.glyphCount > 0,
			),
		).toBe(true);
		expect(fonts.some((font) => font.familyName.includes("Missing Test Font"))).toBe(false);
	} finally {
		await cdp.detach();
	}
	const input = page.getByTestId("font-code-input");
	await input.fill("bad,stack");
	await input.press("Enter");
	await expect(input).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByRole("alert")).toContainText("single font name");
	await input.press("Escape");
	await expect(input).toHaveValue(INTERFACE_FACE);
	await expect(page.getByTestId("settings-dialog")).toBeVisible();
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect.poll(() => family(page, "body")).toMatch(new RegExp(`^"?${CODE_FACE}`));
	await openFonts(page);
	for (const [kind, value] of [
		["interface", CODE_FACE],
		["code", INTERFACE_FACE],
		["terminal", "Missing Test Font 987654"],
	]) {
		await expect(page.getByTestId(`font-${kind}-input`)).toHaveValue(value ?? "");
	}
	const browser = context.browser();
	if (!browser) throw new Error("Browser is unavailable");
	const other = await browser.newContext();
	try {
		const otherPage = await other.newPage();
		await otherPage.goto(page.url());
		await expect(otherPage.getByTestId("connection-status")).toHaveAttribute(
			"data-status",
			"connected",
		);
		expect(await family(otherPage, "body")).toBe(original);
	} finally {
		await other.close();
	}
	await page.getByTestId("font-interface-reset").click();
	await expect.poll(() => family(page, "body")).toBe(original);
	await expect(page.getByTestId("font-code-input")).toHaveValue(INTERFACE_FACE);
	await page.getByTestId("font-terminal-reset").click();
	await expect(page.getByTestId("font-terminal-input")).toHaveValue("");
	await expect
		.poll(() => family(page, '[data-testid="font-terminal-preview"]'))
		.toMatch(new RegExp(`^"?${CODE_FACE}`));
	await input.fill("");
	await input.blur();
	await expect
		.poll(() => family(page, '[data-testid="font-code-preview"]'))
		.toMatch(new RegExp(`^"?${CODE_FACE}`));
});

test("updates mounted Monaco and terminal without replacing the editor or restarting the shell", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).first().dblclick();
	const editor = page.locator(".monaco-editor .view-lines").first();
	await expect(editor).toBeVisible({ timeout: 30_000 });
	await waitTerminalReady(page);
	await runInTerminal(page, "export THINKRAIL_FONT_PROBE=still_here");
	await runInTerminal(page, 'printf "BEFORE_%s\\n" "$THINKRAIL_FONT_PROBE"');
	await expect(visibleTerminalScreen(page)).toContainText("BEFORE_still_here");
	const terminalNode = await visibleTerminal(page).elementHandle();
	const editorNode = await page.locator(".monaco-editor").first().elementHandle();
	const originalTerminal = await visibleTerminalScreen(page).evaluate(
		(el) => getComputedStyle(el).fontFamily,
	);
	await openFonts(page);
	await setFont(page, "code", INTERFACE_FACE);
	await expect
		.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily))
		.toContain(INTERFACE_FACE);
	expect(await visibleTerminalScreen(page).evaluate((el) => getComputedStyle(el).fontFamily)).toBe(
		originalTerminal,
	);
	await setFont(page, "terminal", INTERFACE_FACE);
	await expect
		.poll(() => visibleTerminalScreen(page).evaluate((el) => getComputedStyle(el).fontFamily))
		.toContain(INTERFACE_FACE);
	await page.getByTestId("font-terminal-reset").click();
	await expect
		.poll(() => visibleTerminalScreen(page).evaluate((el) => getComputedStyle(el).fontFamily))
		.toBe(originalTerminal);
	await expect
		.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily))
		.toContain(INTERFACE_FACE);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).not.toBeVisible();
	expect(await terminalNode?.evaluate((el) => el.isConnected)).toBe(true);
	expect(await editorNode?.evaluate((el) => el.isConnected)).toBe(true);
	await runInTerminal(page, 'printf "AFTER_%s\\n" "$THINKRAIL_FONT_PROBE"');
	await expect(visibleTerminalScreen(page)).toContainText("AFTER_still_here");
	await expect(visibleTerminal(page)).toHaveAttribute("data-ready", "true");
});

test("font inputs remain usable on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await openAppFresh(page);
	await openFonts(page);
	for (const kind of ["interface", "code", "terminal"]) {
		await setFont(page, kind, "Missing CJK 字体");
		await page.getByTestId(`font-${kind}-reset`).click();
		await expect(page.getByTestId(`font-${kind}-input`)).toHaveValue("");
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("unavailable persistence still applies fonts and reports the limitation", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "__THINKRAIL_STABLE_PREFERENCES__", {
			configurable: true,
			value: {
				getItem: () => null,
				setItem: () => {
					throw new Error("Storage denied by test");
				},
				removeItem: () => {},
			},
		});
	});
	await openAppFresh(page);
	await openFonts(page);
	await setFont(page, "interface", CODE_FACE);
	await expect.poll(() => family(page, "body")).toContain(CODE_FACE);
	await expect(page.getByTestId("font-storage-warning")).toContainText("couldn't save");
});
