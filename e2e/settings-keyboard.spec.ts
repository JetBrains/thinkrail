import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	settingsDialog,
} from "./fixtures/app";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

const USER_MCP_CONFIG = join(E2E_PI_AGENT_DIR, "mcp.json");
const STDIO_SERVER = fileURLToPath(
	new URL("../packages/server/src/agent/mcp/fixtures/stdioServer.ts", import.meta.url),
);

const tab = (page: Page, id: string) => page.getByTestId(`settings-nav-${id}`);
const searchField = (page: Page) => page.getByTestId("settings-search");
const focusIn = (page: Page, selector: string) =>
	page.evaluate((within) => document.activeElement?.closest(within) != null, selector);
const onFirstRow = (page: Page) =>
	page.evaluate(() => {
		const active = document.activeElement;
		const first = document.querySelector("[data-settings-content] [data-setting-row]");
		return active !== null && active === first;
	});
const focusedRow = (page: Page) =>
	page.evaluate(
		() =>
			document.activeElement?.closest("[data-setting-row]")?.getAttribute("data-setting-row") ??
			null,
	);

function windowsShortcuts(page: Page) {
	return page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" });
		Reflect.set(
			window,
			"__THINKRAIL_NATIVE_SHORTCUTS__",
			Object.freeze({
				subscribeQuitHint: () => () => {},
				subscribeCommand: () => () => {},
				quit: async () => {},
			}),
		);
	});
}

async function openFromGear(page: Page): Promise<Locator> {
	const opener = page.getByTestId("open-settings");
	await opener.focus();
	await page.keyboard.press("Enter");
	await expect(settingsDialog(page)).toBeVisible();
	return opener;
}

async function expectSection(page: Page, id: string): Promise<void> {
	await expect(tab(page, id)).toBeFocused();
	await expect(tab(page, id)).toHaveAttribute("data-active", "true");
	await expect(tab(page, id)).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#settings-panel")).toHaveAttribute(
		"aria-labelledby",
		`settings-tab-${id}`,
	);
}

test("opening lands on the current section's tab; Tab goes search → the one nav stop → the section's first row", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "privacy");
	await closeSettings(page);

	await openFromGear(page);
	await expectSection(page, "privacy");
	await expect(settingsDialog(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
	await expect(settingsDialog(page).getByRole("tablist")).toHaveAttribute(
		"aria-orientation",
		"vertical",
	);

	await page.keyboard.press("Shift+Tab");
	await expect(searchField(page)).toBeFocused();
	await expect(searchField(page)).toHaveAttribute("placeholder", "Search settings");
	await page.keyboard.press("Tab");
	await expect(tab(page, "privacy")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect.poll(() => focusIn(page, "[data-settings-content]")).toBe(true);
	await expect.poll(() => onFirstRow(page)).toBe(true);

	await tab(page, "appearance").click();
	await expectSection(page, "appearance");
	await expect(page.getByTestId("settings-appearance")).toBeVisible();
	await page.keyboard.press("Tab");
	await expect.poll(() => onFirstRow(page)).toBe(true);
	await expect(
		settingsDialog(page).locator('#settings-panel [data-setting-row][tabindex="0"]'),
	).toHaveCount(1);
});

test("↑/↓/j/k/Home/End open a section at once and keep focus on its tab; other letters do nothing", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "appearance");

	await page.keyboard.press("ArrowDown");
	await expectSection(page, "text");
	await expect(page.getByTestId("settings-text")).toBeVisible();
	await page.keyboard.press("j");
	await expectSection(page, "chat");
	await expect(page.getByTestId("settings-chat")).toBeVisible();
	await page.keyboard.press("k");
	await expectSection(page, "text");
	await page.keyboard.press("ArrowUp");
	await expectSection(page, "appearance");
	await page.keyboard.press("End");
	await expectSection(page, "feedback");
	await expect(page.getByTestId("settings-feedback")).toBeVisible();
	await page.keyboard.press("Home");
	await expectSection(page, "models");

	for (const letter of ["x", "q", "1"]) await page.keyboard.press(letter);
	await expectSection(page, "models");
	await page.keyboard.press("ArrowLeft");
	await expectSection(page, "models");
});

test("→, l and Enter go into the content on the setting focused last there, else on its first; ← comes back", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "feedback");
	const rows = settingsDialog(page).locator("#settings-panel [data-setting-row]");
	await expect(rows.first()).toBeVisible();
	const first = await rows.first().getAttribute("data-setting-row");
	const second = await rows.nth(1).getAttribute("data-setting-row");

	await page.keyboard.press("ArrowRight");
	await expect.poll(() => focusedRow(page)).toBe(first);
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("k");
	await expect.poll(() => focusedRow(page)).toBe(first);
	await page.keyboard.press("j");
	await expect.poll(() => focusedRow(page)).toBe(second);
	await page.keyboard.press("ArrowLeft");
	await expectSection(page, "feedback");

	await page.keyboard.press("ArrowUp");
	await expectSection(page, "privacy");
	await page.keyboard.press("Enter");
	await expect.poll(() => focusedRow(page)).toBe("usage-analytics");
	await page.keyboard.press("h");
	await expectSection(page, "privacy");

	await page.keyboard.press("ArrowDown");
	await expectSection(page, "feedback");
	await page.keyboard.press("l");
	await expect.poll(() => focusedRow(page)).toBe(second);
});

test("Esc steps back: a dirty field reverts, then the section list, then Settings closes onto its opener", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "text");
	await closeSettings(page);
	const opener = await openFromGear(page);
	await expectSection(page, "text");

	const input = page.getByTestId("chat-line-width-input");
	const saved = await input.inputValue();
	await input.fill(String(Number(saved) + 7));
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue(saved);
	await expect(input).toBeFocused();
	await expect(settingsDialog(page)).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(page.locator('[data-setting-row="chat-line-width"]')).toBeFocused();
	await page.keyboard.press("Escape");
	await expectSection(page, "text");
	await page.keyboard.press("Escape");
	await expect(settingsDialog(page)).toBeHidden();
	await expect(opener).toBeFocused();
});

test("one ↑/↓ walk crosses a switch row, a field row, a tree and a row without wrapping; Home and End reach the ends", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "keyboard");
	const row = (id: string) => settingsDialog(page).locator(`[data-setting-row="${id}"]`);
	const doubleShift = row("double-shift");
	const filterRow = row("keyboard-filter");
	const filter = page.getByTestId("keybinding-filter");
	const exportRow = row("keyboard-import-export");
	const items = settingsDialog(page).locator(
		'[data-setting-row="keyboard-shortcuts"] [role="treeitem"]',
	);
	await expect(items.nth(1)).toBeVisible();

	await page.keyboard.press("ArrowRight");
	await expect(doubleShift).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(doubleShift).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(filterRow).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("keybinding-search-keys")).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(filterRow).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(filter).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(items.first()).toBeFocused();
	await page.keyboard.press("j");
	await expect(items.nth(1)).toBeFocused();
	await page.keyboard.press("End");
	await expect(items.last()).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(exportRow).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(exportRow).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(items.last()).toBeFocused();
	await page.keyboard.press("Home");
	await expect(items.first()).toBeFocused();
	await page.keyboard.press("k");
	await expect(filterRow).toBeFocused();

	await page.getByTestId("keybinding-export").focus();
	await page.keyboard.press("Home");
	await expect(doubleShift).toBeFocused();
	await page.keyboard.press("End");
	await expect(exportRow).toBeFocused();

	await filter.fill("split");
	const shortcuts = settingsDialog(page).getByTestId("keybinding-row");
	await expect(shortcuts.nth(1)).toBeVisible();
	await shortcuts.nth(1).getByTestId("keybinding-change").focus();
	await page.keyboard.press("Home");
	await expect(items.first()).toBeFocused();
	await shortcuts.first().getByTestId("keybinding-change").focus();
	await page.keyboard.press("End");
	await expect(items.last()).toBeFocused();
});

test("a list walks row by row; → reaches its buttons, Delete asks first and focus lands on the neighbour row, Enter opens it; Shift+F10 opens the row menu", async ({
	page,
}) => {
	const entry = { command: resolveBunExecutable(), args: [STDIO_SERVER], enabled: false };
	writeFileSync(
		USER_MCP_CONFIG,
		JSON.stringify({
			mcpServers: { "walk-alpha": entry, "walk-beta": entry, "walk-gamma": entry },
		}),
	);
	try {
		await openFixtureProject(page);
		await enterDefaultWorkspace(page);
		await openSettingsSection(page, "mcp");
		const rows = page.getByTestId("mcp-server-row");
		await expect(rows).toHaveCount(3);
		const names = await rows.evaluateAll((list) =>
			list.map((row) => row.getAttribute("data-name")),
		);
		const row = (index: number) =>
			page.locator(`[data-testid="mcp-server-row"][data-name="${names[index]}"]`);

		await page.keyboard.press("ArrowRight");
		await expect(settingsDialog(page).locator('[data-setting-row="mcp-add"]')).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(row(0)).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(row(1)).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(row(2)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(row(1)).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(row(1).getByTestId("mcp-server-menu")).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(row(1)).toBeFocused();
		await expect(row(1).getByTestId("mcp-server-toggle")).toHaveAttribute("aria-checked", "false");

		await page.keyboard.press("Delete");
		const confirm = page.getByTestId("mcp-remove-confirm");
		await expect(confirm).toBeVisible();
		await expect(rows).toHaveCount(3);
		await confirm.click();
		await expect(rows).toHaveCount(2);
		await expect(row(2)).toBeFocused();
		await expect(settingsDialog(page)).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("mcp-details-dialog")).toBeVisible();
		await expect(page.getByTestId("mcp-details-dialog")).toContainText(names[2] ?? "");
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("mcp-details-dialog")).toHaveCount(0);
		await expect(row(2)).toBeFocused();

		await page.keyboard.press("Shift+F10");
		await expect(page.getByTestId("mcp-menu-remove")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("mcp-menu-remove")).toHaveCount(0);
		await expect(settingsDialog(page)).toBeVisible();
	} finally {
		rmSync(USER_MCP_CONFIG, { force: true });
	}
});

test.describe("cheap and expensive choices", () => {
	test.afterEach(async ({ baseURL }) => {
		if (!baseURL) throw new Error("Settings keyboard fixtures require the isolated host URL");
		const wire = await E2eWire.connect(Number(new URL(baseURL).port));
		try {
			await wire.request("settings.update", { config: { locale: "system" } });
		} finally {
			wire.close();
		}
	});

	test("a cheap choice is entered with Enter, applies on each arrow, and Esc returns to the row keeping it; → then reaches Reset; Delete resets", async ({
		page,
	}) => {
		await openFixtureProject(page);
		await openSettingsSection(page, "chat");
		const row = settingsDialog(page).locator('[data-setting-row="message-order"]');
		const oldest = page.getByTestId("chat-order-oldest-first");
		const newest = page.getByTestId("chat-order-newest-first");
		const reset = page.getByTestId("settings-reset-message-order");
		await expect(oldest).toHaveAttribute("data-active", "true");
		await expect(reset).toHaveCount(0);

		await page.keyboard.press("ArrowRight");
		await expect(row).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(oldest).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(newest).toBeFocused();
		await expect(newest).toHaveAttribute("data-active", "true");
		await expect(settingsDialog(page).getByText("Press Enter to apply")).toHaveCount(0);
		await page.keyboard.press("ArrowRight");
		await expect(newest).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(row).toBeFocused();
		await expect(newest).toHaveAttribute("data-active", "true");
		await expect(settingsDialog(page)).toBeVisible();

		await page.keyboard.press("ArrowRight");
		await expect(reset).toBeFocused();
		await expect(newest).toHaveAttribute("data-active", "true");
		await page.keyboard.press("ArrowRight");
		await expect(reset).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(row).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Delete");
		await expect(oldest).toHaveAttribute("data-active", "true");
		await expect(reset).toHaveCount(0);
		await expect(row).toBeFocused();
	});

	test("an expensive choice keeps a pending pick until Enter applies it and returns to the row; Esc cancels it and returns; Delete resets", async ({
		page,
	}) => {
		await openFixtureProject(page);
		await openSettingsSection(page, "language");
		const row = settingsDialog(page).locator('[data-setting-row="interface-language"]');
		const system = page.getByTestId("language-system");
		const english = page.getByTestId("language-en");
		const hint = settingsDialog(page).getByText("Press Enter to apply");
		await expect(system).toHaveAttribute("data-active", "true");

		await page.keyboard.press("ArrowRight");
		await expect(row).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(row).not.toBeFocused();
		await expect(system).toHaveAttribute("data-active", "true");
		await expect(english).not.toHaveAttribute("data-pending", "true");
		await page.keyboard.press("ArrowUp");
		await expect(row).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(system).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(english).toBeFocused();
		await expect(english).toHaveAttribute("data-pending", "true");
		await expect(system).toHaveAttribute("data-active", "true");
		await expect(hint).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(row).toBeFocused();
		await expect(english).not.toHaveAttribute("data-pending", "true");
		await expect(system).toHaveAttribute("data-active", "true");
		await expect(hint).toHaveCount(0);
		await expect(settingsDialog(page)).toBeVisible();

		await page.keyboard.press("Enter");
		await page.keyboard.press("ArrowDown");
		await expect(english).toHaveAttribute("data-pending", "true");
		await page.keyboard.press("Enter");
		await expect(english).toHaveAttribute("data-active", "true");
		await expect(row).toBeFocused();
		await expect(row).toHaveAttribute("data-changed", "true");
		await page.keyboard.press("Delete");
		await expect(system).toHaveAttribute("data-active", "true");
		await expect(row).not.toHaveAttribute("data-changed", "true");
	});
});

test("walking ↓ and ↑ through Appearance lands on whole rows and never changes the theme", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "appearance");
	const html = page.locator("html");
	const theme = await html.getAttribute("data-theme");
	const rows = settingsDialog(page).locator("#settings-panel [data-setting-row]");
	const count = await rows.count();
	expect(count).toBeGreaterThan(3);

	await page.keyboard.press("ArrowRight");
	const seen: (string | null)[] = [];
	for (let step = 0; step < count + 2; step += 1) {
		seen.push(await focusedRow(page));
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-setting-row")))
			.toBe(true);
		await page.keyboard.press("ArrowDown");
	}
	for (let step = 0; step < count + 2; step += 1) await page.keyboard.press("k");
	expect(seen).toContain("dark-theme");
	expect(seen).toContain("contrast");
	await expect(html).toHaveAttribute("data-theme", theme ?? "");
	await expect(settingsDialog(page).locator('[data-setting-row][data-changed="true"]')).toHaveCount(
		0,
	);
});

test("Space on a switch row toggles it and stays on the row; Enter enters a field and Esc leaves it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "keyboard");
	const row = settingsDialog(page).locator('[data-setting-row="double-shift"]');
	const toggle = page.getByTestId("settings-double-shift");
	await page.keyboard.press("ArrowRight");
	await expect(row).toBeFocused();
	const before = await toggle.getAttribute("aria-checked");
	await page.keyboard.press(" ");
	await expect(row).toBeFocused();
	await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "");
	await page.keyboard.press("Enter");
	await expect(toggle).toHaveAttribute("aria-checked", before ?? "");
	await expect(row).toBeFocused();

	const filterRow = settingsDialog(page).locator('[data-setting-row="keyboard-filter"]');
	const filter = page.getByTestId("keybinding-filter");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press(" ");
	await expect(filter).toBeFocused();
	await page.keyboard.type("split");
	await expect(filter).toHaveValue("split");
	await page.keyboard.press("Enter");
	await expect(filterRow).toBeFocused();
	await expect(filter).toHaveValue("split");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(filter).toHaveValue("");
	await expect(filter).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(filterRow).toBeFocused();
});

test("content scroll starts at the top in every section", async ({ page }) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "providers");
	const scroller = page.getByTestId("settings-scroller");
	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

	await tab(page, "providers").focus();
	await page.keyboard.press("ArrowDown");
	await expect(tab(page, "providers")).toHaveAttribute("data-active", "false");
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
	await page.keyboard.press("ArrowUp");
	await expect(tab(page, "providers")).toHaveAttribute("data-active", "true");
	await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
});

test("Ctrl+, toggles Settings from inside it, and Ctrl+W closes it at once from a field, keeping the edit", async ({
	page,
}) => {
	await windowsShortcuts(page);
	await openFixtureProject(page);
	const dialog = settingsDialog(page);
	await page.getByTestId("open-settings").focus();

	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeVisible();
	await tab(page, "text").click();
	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeHidden();
	await page.keyboard.press("Control+Comma");
	await expect(dialog).toBeVisible();
	await expectSection(page, "text");

	const input = page.getByTestId("chat-line-width-input");
	const saved = await input.inputValue();
	const edited = String(Number(saved) + 3);
	await input.fill(edited);
	await page.keyboard.press("Control+w");
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("open-settings")).toBeFocused();

	await page.keyboard.press("Control+Comma");
	await expect(input).toHaveValue(edited);
	await input.fill(saved);
	await page.keyboard.press("Enter");
	await tab(page, "text").focus();
	await page.keyboard.press("Control+w");
	await expect(dialog).toBeHidden();
	await page.keyboard.press("Control+Comma");
	await expect(input).toHaveValue(saved);
	await closeSettings(page);
});
