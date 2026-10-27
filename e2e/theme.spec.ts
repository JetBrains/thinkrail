import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	expandDisclosure,
	openFixtureProject,
	revealWorkbenchTool,
} from "./fixtures/app";

interface ThemeOption {
	id: string;
	label: string;
	appearance: "light" | "dark";
	contrast: "normal" | "high";
	active: boolean;
}

async function openAppearance(page: Page) {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");
	return dialog;
}

/** Opens Appearance with its fixed-mode theme list, which the page keeps in a collapsed disclosure. */
async function openThemeList(page: Page) {
	const dialog = await openAppearance(page);
	await expandDisclosure(dialog.getByTestId("theme-toggle"));
	return dialog;
}

async function readThemeOptions(page: Page): Promise<ThemeOption[]> {
	const dialog = await openThemeList(page);
	const options = await dialog.locator('[data-testid^="theme-option-"]').evaluateAll((nodes) =>
		nodes.map((node) => ({
			id: node.getAttribute("data-theme-id") ?? "",
			label: node.textContent?.trim() ?? "",
			appearance: node.getAttribute("data-appearance") === "light" ? "light" : "dark",
			contrast: node.getAttribute("data-contrast") === "high" ? "high" : "normal",
			active: node.getAttribute("data-active") === "true",
		})),
	);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	return options;
}

async function pickTheme(page: Page, theme: string): Promise<void> {
	const dialog = await openThemeList(page);
	await dialog.locator(`[data-theme-id="${theme}"]`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function restoreSystemPairLight(
	page: Page,
	light: string,
	fixedAppearance: ThemeOption["appearance"],
): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) await openAppearance(page);
	await dialog.getByTestId("theme-mode-system").click();
	const trigger = dialog.getByTestId("system-theme-light-trigger");
	if (!(await trigger.isVisible())) await expandDisclosure(dialog.getByTestId("theme-pair-toggle"));
	await trigger.click();
	await page.getByTestId(`system-theme-light-option-${light}`).click();
	await dialog.getByTestId(`theme-mode-${fixedAppearance}`).click();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function expectEditorMatchesTheme(page: Page): Promise<void> {
	const colors = await page
		.locator(".monaco-editor")
		.first()
		.evaluate((editor) => {
			const token = getComputedStyle(document.documentElement)
				.getPropertyValue("--container-workspace-bg")
				.trim();
			const probe = document.createElement("div");
			probe.style.backgroundColor = token;
			document.body.append(probe);
			const expected = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return { expected, actual: getComputedStyle(editor).backgroundColor };
		});
	expect(colors.actual).toBe(colors.expected);
}

test("appearance switches a discovered theme and persists it across reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const options = await readThemeOptions(page);
	expect(options.length).toBeGreaterThan(1);
	const defaultTheme = options.find((option) => option.active)?.id;
	expect(defaultTheme).toBeTruthy();
	await expect(page.locator("html")).toHaveAttribute("data-theme", defaultTheme ?? "");

	const target = options.find((option) => option.id !== defaultTheme)?.id;
	expect(target).toBeTruthy();
	await pickTheme(page, target ?? "");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.locator("html")).toHaveAttribute("data-theme", target ?? "");

	await pickTheme(page, defaultTheme ?? "");
});

test("system mode follows each client and retains its explicit pair", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const options = await readThemeOptions(page);
	const fixed = options.find((option) => option.active);
	const initialLight = options.find(
		(option) => option.appearance === "light" && option.contrast === fixed?.contrast,
	);
	const alternateLight = options.find(
		(option) => option.appearance === "light" && option.id !== initialLight?.id,
	);
	expect(fixed).toBeDefined();
	expect(initialLight).toBeDefined();
	expect(alternateLight).toBeDefined();

	const dialog = await openAppearance(page);
	await dialog.getByTestId("theme-mode-system").click();
	const peer = await page.context().newPage();
	try {
		await expect(page.locator("html")).toHaveAttribute("data-theme", initialLight?.id ?? "");
		await expect(dialog.getByTestId("system-theme-current")).toContainText("Light");
		await expandDisclosure(dialog.getByTestId("theme-pair-toggle"));
		await expect(dialog.getByTestId("system-theme-light-trigger")).toHaveAccessibleName(
			`Light theme: ${initialLight?.label}`,
		);
		await dialog.getByTestId("system-theme-light-trigger").click();
		await page.getByTestId(`system-theme-light-option-${alternateLight?.id}`).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", alternateLight?.id ?? "");

		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator("html")).toHaveAttribute("data-theme", fixed?.id ?? "");
		await expect(dialog.getByTestId("system-theme-current")).toContainText("Dark");

		await peer.emulateMedia({ colorScheme: "light" });
		await peer.goto("/");
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
		await expect(peer.locator("html")).toHaveAttribute("data-theme", alternateLight?.id ?? "");

		await dialog.getByTestId(`theme-mode-${fixed?.appearance}`).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", fixed?.id ?? "");
		await expect(peer.locator("html")).toHaveAttribute("data-theme", fixed?.id ?? "");

		await dialog.getByTestId("theme-mode-system").click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", fixed?.id ?? "");
		await expect(peer.locator("html")).toHaveAttribute("data-theme", alternateLight?.id ?? "");
	} finally {
		await peer.close();
		await restoreSystemPairLight(page, initialLight?.id ?? "", fixed?.appearance ?? "dark");
	}
});

test("Monaco opens files and re-themes under every discovered manifest", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const options = await readThemeOptions(page);
	const defaultTheme = options.find((option) => option.active)?.id;
	expect(defaultTheme).toBeTruthy();
	expect(options.some((option) => option.contrast === "high")).toBe(true);
	const mountTheme = options.find((option) => option.appearance === "light") ?? options[0];
	expect(mountTheme).toBeDefined();
	await pickTheme(page, mountTheme?.id ?? "");

	await revealWorkbenchTool(page, "files");
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");

	for (const option of options) {
		await pickTheme(page, option.id);
		await expect(page.locator("html")).toHaveAttribute("data-theme-contrast", option.contrast);
		await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
		await expectEditorMatchesTheme(page);
		if (option.contrast === "high") {
			const selectedText = await page.locator("html").evaluate((root) => ({
				browser: getComputedStyle(root).getPropertyValue("--selection-text").trim(),
				editor: getComputedStyle(root).getPropertyValue("--editor-selection-text").trim(),
			}));
			expect(selectedText.browser).not.toBe("");
			expect(selectedText.editor).not.toBe("");
		}
	}

	await pickTheme(page, defaultTheme ?? "");
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
});

async function keywordToken(page: Page) {
	const keyword = page
		.locator('[data-testid="editor-pane"]:visible .view-line span span', { hasText: /^export$/ })
		.first();
	await expect(keyword).not.toHaveClass(/\bmtk1\b/);
	return keyword.evaluate((node) => ({
		className: node.className,
		color: getComputedStyle(node).color,
	}));
}

test("Monaco keeps syntax colours across a light/dark swap", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "swap.ts"), "export const answer = 42;\n");
	writeFileSync(join(workspace.worktreePath, "later.ts"), "export const later = 7;\n");
	const options = await readThemeOptions(page);
	const light = options.find(
		(option) => option.appearance === "light" && option.contrast === "normal",
	);
	const dark = options.find(
		(option) => option.appearance === "dark" && option.contrast === "normal",
	);
	const defaultTheme = options.find((option) => option.active)?.id;
	expect(light && dark).toBeTruthy();
	await pickTheme(page, light?.id ?? "");

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "swap.ts" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("answer");
	const before = await keywordToken(page);

	await pickTheme(page, dark?.id ?? "");
	await expect.poll(async () => (await keywordToken(page)).color).not.toBe(before.color);
	const after = await keywordToken(page);

	await page.getByTestId("file-node").filter({ hasText: "later.ts" }).dblclick();
	await expect(page.locator('[data-testid="editor-pane"]:visible')).toContainText("later");
	expect(await keywordToken(page)).toEqual(after);
	await pickTheme(page, defaultTheme ?? "");
});

test("an editor preloaded before a theme swap opens in the current theme", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "swap.ts"), "export const answer = 42;\n");
	const options = await readThemeOptions(page);
	const defaultTheme = options.find((option) => option.active)?.id;
	const light = options.find(
		(option) => option.appearance === "light" && option.contrast === "normal",
	);
	const dark = options.find(
		(option) => option.appearance === "dark" && option.contrast === "normal",
	);
	expect(light && dark).toBeTruthy();
	await pickTheme(page, dark?.id ?? "");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith(".wasm"))
						.length,
			),
		)
		.toBeGreaterThan(0);
	await pickTheme(page, light?.id ?? "");

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "swap.ts" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("answer");
	await expectEditorMatchesTheme(page);
	const first = await keywordToken(page);

	await pickTheme(page, dark?.id ?? "");
	await expect.poll(async () => (await keywordToken(page)).color).not.toBe(first.color);
	await pickTheme(page, light?.id ?? "");
	await expect.poll(async () => (await keywordToken(page)).color).toBe(first.color);
	await pickTheme(page, defaultTheme ?? "");
});

test("selected workspace tabs keep their surface and edge marker, and rail entries their surface, under every manifest", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	const options = await readThemeOptions(page);
	expect(options.length).toBeGreaterThanOrEqual(2);
	const defaultTheme = options.find((option) => option.active)?.id;

	await revealWorkbenchTool(page, "files");
	const files = page.getByTestId("file-node");
	await files.filter({ hasText: "README.md" }).dblclick();
	await files.filter({ hasText: "notes.txt" }).click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);

	await page.getByTestId("terminal-add").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);

	const strips = [
		page.getByTestId("center-tab-strip"),
		page.getByTestId("bottom-tab-strip").filter({ has: page.getByTestId("terminal-tab") }),
	];
	for (const strip of strips) {
		await expect(strip.getByRole("tablist")).toHaveCount(1);
		await expect(strip.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
	}

	for (const theme of options) {
		await pickTheme(page, theme.id);
		const state = await page.evaluate(() => {
			const tabs = Array.from(
				document.querySelectorAll<HTMLElement>(
					'[data-testid="editor-tab"][data-active="true"], [data-testid="terminal-tab"][data-active="true"]',
				),
			);
			const resolveColor = (property: string): string => {
				const probe = document.createElement("div");
				probe.style.backgroundColor = `var(${property})`;
				document.body.append(probe);
				const color = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return color;
			};
			return {
				expectedFill: resolveColor("--control-bg-selected"),
				expectedMarker: resolveColor("--primary"),
				tabs: tabs.map((element) => ({
					fill: getComputedStyle(element).backgroundColor,
					marker: getComputedStyle(element, "::after").backgroundColor,
					markerHeight: getComputedStyle(element, "::after").height,
				})),
			};
		});
		expect(state.tabs).toHaveLength(2);
		for (const tab of state.tabs) {
			expect(tab.fill).toBe(state.expectedFill);
			expect(tab.marker).toBe(state.expectedMarker);
			expect(tab.markerHeight).toBe("2px");
		}
		const tool = page.getByTestId("tab-files");
		const toolButton = page.getByTestId("tool-rail-files");
		await expect(toolButton).toHaveAttribute("aria-pressed", "true");
		await expect(toolButton).toHaveCSS("background-color", state.expectedFill);
		await expect(tool.getByTestId("rail-selection-indicator")).toHaveCount(0);
	}
	await pickTheme(page, defaultTheme ?? "");
});
