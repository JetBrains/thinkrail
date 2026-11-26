import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	closeSettings,
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	revealWorkbenchTool,
} from "./fixtures/app";

type Appearance = "light" | "dark";

interface ThemeOption {
	id: string;
	label: string;
	appearance: Appearance;
	active: boolean;
}

async function openAppearance(page: Page): Promise<Locator> {
	const dialog = await openSettingsSection(page, "appearance");
	await expect(dialog.getByTestId("theme-mode-control")).toBeVisible();
	return dialog;
}

/** The theme options one list shows: Light or Dark mode shows its own list, System both. */
async function readList(dialog: Locator, appearance: Appearance): Promise<ThemeOption[]> {
	const list = dialog.getByTestId(`theme-list-${appearance}`);
	await expect(list.getByRole("option").first()).toBeVisible();
	return list.getByRole("option").evaluateAll(
		(nodes, listAppearance) =>
			nodes.map((node) => ({
				id: (node.getAttribute("data-testid") ?? "").replace(/^theme-option-/, ""),
				label: node.textContent?.trim() ?? "",
				appearance: listAppearance,
				active: node.getAttribute("aria-selected") === "true",
			})),
		appearance,
	);
}

/** Every discovered theme, read from the Light and Dark lists; the current theme comes back after. */
async function readThemeOptions(page: Page): Promise<ThemeOption[]> {
	const dialog = await openAppearance(page);
	const mode =
		(await dialog.getByTestId("theme-mode-light").getAttribute("aria-selected")) === "true"
			? "light"
			: "dark";
	const other: Appearance = mode === "light" ? "dark" : "light";
	const current = await readList(dialog, mode);
	const active = current.find((option) => option.active);
	if (!active) throw new Error("No active theme");
	await dialog.getByTestId(`theme-mode-${other}`).click();
	const opposite = (await readList(dialog, other)).map((option) => ({ ...option, active: false }));
	await dialog.getByTestId(`theme-mode-${mode}`).click();
	await dialog.getByTestId(`theme-option-${active.id}`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", active.id);
	await closeSettings(page);
	return [...current, ...opposite];
}

/** Applies a theme from its mode's list and returns the contrast the Contrast control shows for it. */
async function pickTheme(page: Page, theme: ThemeOption): Promise<"normal" | "high"> {
	const dialog = await openAppearance(page);
	await dialog.getByTestId(`theme-mode-${theme.appearance}`).click();
	await dialog.getByTestId(`theme-option-${theme.id}`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
	await expect(dialog.getByTestId(`theme-option-${theme.id}`)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	const high = await dialog.getByTestId("contrast-high").getAttribute("aria-selected");
	await closeSettings(page);
	return high === "true" ? "high" : "normal";
}

function themeById(options: readonly ThemeOption[], id: string | undefined): ThemeOption {
	const theme = options.find((option) => option.id === id);
	if (!theme) throw new Error(`No theme ${id}`);
	return theme;
}

async function restoreSystemPairLight(
	page: Page,
	light: string,
	fixedAppearance: Appearance,
): Promise<void> {
	const dialog = await openAppearance(page);
	await dialog.getByTestId("theme-mode-system").click();
	await dialog.getByTestId(`theme-option-${light}`).click();
	await expect(dialog.getByTestId(`theme-option-${light}`)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await dialog.getByTestId(`theme-mode-${fixedAppearance}`).click();
	await closeSettings(page);
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

	const target = options.find((option) => option.id !== defaultTheme);
	expect(target).toBeTruthy();
	await pickTheme(page, themeById(options, target?.id));

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.locator("html")).toHaveAttribute("data-theme", target?.id ?? "");

	await pickTheme(page, themeById(options, defaultTheme));
});

test("system mode follows each client and retains its explicit pair", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const options = await readThemeOptions(page);
	const fixed = options.find((option) => option.active);
	expect(fixed).toBeDefined();

	const dialog = await openAppearance(page);
	await dialog.getByTestId("theme-mode-system").click();
	const lights = await readList(dialog, "light");
	await expect(dialog.getByTestId("theme-list-dark").getByRole("option").first()).toBeVisible();
	const initialLight = lights.find((option) => option.active);
	const alternateLight = lights.find((option) => !option.active);
	expect(initialLight).toBeDefined();
	expect(alternateLight).toBeDefined();
	const peer = await page.context().newPage();
	try {
		await expect(page.locator("html")).toHaveAttribute("data-theme", initialLight?.id ?? "");
		await expect(dialog.getByTestId("system-theme-current")).toContainText("Light");
		await expect(dialog.getByTestId(`theme-option-${fixed?.id}`)).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await dialog.getByTestId(`theme-option-${alternateLight?.id}`).click();
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
	const mountTheme = options.find((option) => option.appearance === "light") ?? options[0];
	expect(mountTheme).toBeDefined();
	await pickTheme(page, themeById(options, mountTheme?.id));

	await revealWorkbenchTool(page, "files");
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");

	const contrasts = new Set<string>();
	for (const option of options) {
		const contrast = await pickTheme(page, option);
		contrasts.add(contrast);
		await expect(page.locator("html")).toHaveAttribute("data-theme-contrast", contrast);
		await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
		await expectEditorMatchesTheme(page);
		if (contrast === "high") {
			const selectedText = await page.locator("html").evaluate((root) => ({
				browser: getComputedStyle(root).getPropertyValue("--selection-text").trim(),
				editor: getComputedStyle(root).getPropertyValue("--editor-selection-text").trim(),
			}));
			expect(selectedText.browser).not.toBe("");
			expect(selectedText.editor).not.toBe("");
		}
	}

	expect([...contrasts].sort()).toEqual(["high", "normal"]);
	await pickTheme(page, themeById(options, defaultTheme));
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
});

async function keywordToken(page: Page) {
	const keyword = page
		.locator('[data-testid="editor-pane"]:visible .view-line span span', { hasText: /export/ })
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
	const light = themeById(options, "light");
	const dark = themeById(options, "dark");
	const defaultTheme = options.find((option) => option.active)?.id;
	await pickTheme(page, light);

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "swap.ts" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("answer");
	const before = await keywordToken(page);

	await pickTheme(page, dark);
	await expect.poll(async () => (await keywordToken(page)).color).not.toBe(before.color);
	const after = await keywordToken(page);

	await page.getByTestId("file-node").filter({ hasText: "later.ts" }).dblclick();
	await expect(page.locator('[data-testid="editor-pane"]:visible')).toContainText("later");
	expect(await keywordToken(page)).toEqual(after);
	await pickTheme(page, themeById(options, defaultTheme));
});

test("an editor preloaded before a theme swap opens in the current theme", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	writeFileSync(join(workspace.worktreePath, "swap.ts"), "export const answer = 42;\n");
	const options = await readThemeOptions(page);
	const defaultTheme = options.find((option) => option.active)?.id;
	const light = themeById(options, "light");
	const dark = themeById(options, "dark");
	await pickTheme(page, dark);
	await pickTheme(page, light);

	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "swap.ts" }).dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("answer");
	await expectEditorMatchesTheme(page);
	const first = await keywordToken(page);

	await pickTheme(page, dark);
	await expect.poll(async () => (await keywordToken(page)).color).not.toBe(first.color);
	await pickTheme(page, light);
	await expect.poll(async () => (await keywordToken(page)).color).toBe(first.color);
	await pickTheme(page, themeById(options, defaultTheme));
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
		await pickTheme(page, theme);
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
	await pickTheme(page, themeById(options, defaultTheme));
});
