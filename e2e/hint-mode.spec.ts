import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";

const overlay = (page: Page) => page.getByTestId("hint-mode");
const labels = (page: Page) => page.getByTestId("hint-label");
const HINT_TOGGLE = "extension-toggle-hint-mode";

async function labelFor(page: Page, target: Locator): Promise<string> {
	await expect(target).toBeVisible();
	const box = await target.boundingBox();
	if (!box) throw new Error("the target has no box");
	const hits = await page.evaluate(({ x, y }) => {
		const left = Math.max(2, x - 4);
		const top = Math.max(2, y - 6);
		return Array.from(document.querySelectorAll<HTMLElement>("[data-hint-label]"))
			.filter((label) => {
				const rect = label.getBoundingClientRect();
				return Math.abs(rect.left - left) < 1 && Math.abs(rect.top - top) < 1;
			})
			.map((label) => label.dataset.hintLabel ?? "");
	}, box);
	if (hits.length !== 1 || !hits[0]) {
		throw new Error(`expected one label on the target, found: ${hits.join(", ") || "none"}`);
	}
	return hits[0];
}

async function settle(page: Page): Promise<void> {
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
				)
				.map((animation) => animation.finished.catch(() => undefined)),
		),
	);
}

async function typeLabel(page: Page, label: string, { shift = false } = {}): Promise<void> {
	const letters = [...label];
	for (const [index, letter] of letters.entries()) {
		const last = index === letters.length - 1;
		await page.keyboard.press(shift && last ? `Shift+${letter.toUpperCase()}` : letter);
	}
}

async function expectLabelsInside(page: Page, container: Locator): Promise<void> {
	const box = await container.boundingBox();
	if (!box) throw new Error("the container has no box");
	await expect(labels(page).first()).toBeVisible();
	const outside = await page.evaluate(
		({ x, y, width, height }) =>
			Array.from(document.querySelectorAll<HTMLElement>("[data-hint-label]"))
				.map((label) => ({ label: label.dataset.hintLabel, rect: label.getBoundingClientRect() }))
				.filter(
					({ rect }) =>
						rect.left + 4 < x - 1 ||
						rect.top + 6 < y - 1 ||
						rect.left > x + width ||
						rect.top > y + height,
				)
				.map(({ label }) => label),
		box,
	);
	expect(outside).toEqual([]);
}

async function openExtensionsSettings(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const section = page.getByTestId("settings-extensions");
	await expect(section).toBeVisible();
	return section;
}

async function closeSettings(page: Page): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	if (!(await dialog.isVisible())) return;
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function setHintMode(page: Page, enabled: boolean): Promise<void> {
	await closeSettings(page);
	await openExtensionsSettings(page);
	const toggle = page.getByTestId(HINT_TOGGLE);
	if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
	await closeSettings(page);
}

test.afterEach(async ({ page }) => {
	if (page.isClosed()) return;
	await setHintMode(page, true);
});

test("F outside a text field and Mod+; anywhere show labels; a label presses a button or focuses a field", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const input = page.getByTestId("chat-input");
	await input.focus();
	await page.keyboard.press("f");
	await expect(input).toHaveValue("f");
	await expect(overlay(page)).toHaveCount(0);
	await input.fill("");

	await pressPlatformShortcut(page, ";");
	await expect(overlay(page)).toBeVisible();
	await expect(page.getByTestId("hint-mode-bar")).toContainText("Type a label");
	await page.keyboard.press("Escape");
	await expect(overlay(page)).toHaveCount(0);
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("");

	const files = page.getByTestId("tool-rail-files");
	const pressed = await files.getAttribute("aria-pressed");
	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await expect(overlay(page)).toBeVisible();
	await typeLabel(page, await labelFor(page, files));
	await expect(overlay(page)).toHaveCount(0);
	await expect(files).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");

	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await typeLabel(page, await labelFor(page, input));
	await expect(overlay(page)).toHaveCount(0);
	await expect(input).toBeFocused();
	await expect(input).toHaveValue("");

	await pressPlatformShortcut(page, ";");
	await expect(overlay(page)).toBeVisible();
	await pressPlatformShortcut(page, ";");
	await expect(overlay(page)).toHaveCount(0);
});

test("a label opens a dropdown, and with the menu open only its items are labelled", async ({
	page,
}) => {
	await openFixtureProject(page);
	const trigger = page.getByTestId("add-project-menu");
	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await typeLabel(page, await labelFor(page, trigger));
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();

	await page.keyboard.press("f");
	await expect(overlay(page)).toBeVisible();
	await expectLabelsInside(page, menu);
	await page.keyboard.press("Escape");
	await expect(overlay(page)).toHaveCount(0);
	await expect(menu).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
});

test("typing narrows the labels, Backspace undoes a letter and Shift on the last letter only focuses", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	const tree = page.getByRole("tree", { name: "Files" });
	const readme = tree.getByTestId("file-node").filter({ hasText: /^README\.md/ });
	await readme.focus();
	await settle(page);

	await page.keyboard.press("f");
	await expect(overlay(page)).toBeVisible();
	const all = await labels(page).evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute("data-hint-label") ?? ""),
	);
	const pair = all.find((label) => label.length === 2);
	if (!pair) throw new Error("expected two-letter labels in a full workbench");
	const [first] = pair;
	await page.keyboard.press(first ?? "");
	const narrowed = await labels(page).evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute("data-hint-label") ?? ""),
	);
	expect(narrowed.length).toBeLessThan(all.length);
	expect(narrowed.every((label) => label.startsWith(first ?? ""))).toBe(true);
	await expect(labels(page).first().locator("span").first()).toHaveText(first ?? "");
	await page.keyboard.press("Backspace");
	await expect(labels(page)).toHaveCount(all.length);

	await typeLabel(page, await labelFor(page, readme), { shift: true });
	await expect(overlay(page)).toHaveCount(0);
	await expect(readme).toBeFocused();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveCount(0);
});

test("Monaco and xterm take one label each, and their label only focuses the widget", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "files");
	const tree = page.getByRole("tree", { name: "Files" });
	await tree
		.getByTestId("file-node")
		.filter({ hasText: /^notes\.txt/ })
		.dblclick();
	const editor = page.locator('[data-testid="editor-pane"]:visible .monaco-editor');
	await expect(editor).toBeVisible();
	await waitTerminalReady(page);
	const terminal = visibleTerminal(page).locator(".xterm");
	const focused = () =>
		page.evaluate(() => {
			const active = document.activeElement;
			return active?.closest(".monaco-editor")
				? "monaco"
				: active?.closest(".xterm")
					? "xterm"
					: "";
		});

	await page.getByTestId("open-search").focus();
	await settle(page);
	await page.keyboard.press("f");
	await typeLabel(page, await labelFor(page, editor));
	await expect.poll(focused).toBe("monaco");

	await pressPlatformShortcut(page, ";");
	await typeLabel(page, await labelFor(page, terminal));
	await expect.poll(focused).toBe("xterm");
});

test("with a dialog open only its controls are labelled, and Escape leaves the dialog open", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();

	await pressPlatformShortcut(page, ";");
	await expect(overlay(page)).toBeVisible();
	await expectLabelsInside(page, dialog);
	await page.keyboard.press("Escape");
	await expect(overlay(page)).toHaveCount(0);
	await expect(dialog).toBeVisible();

	const extensions = page.getByTestId("settings-nav-extensions");
	await extensions.scrollIntoViewIfNeeded();
	await pressPlatformShortcut(page, ";");
	await typeLabel(page, await labelFor(page, extensions));
	await expect(page.getByTestId("settings-extensions")).toBeVisible();
	await expect(dialog).toBeVisible();
});

test("Settings → Extensions lists hint mode; off, F and Mod+; do nothing and its shortcuts leave the cheatsheet", async ({
	page,
}) => {
	await openFixtureProject(page);
	const section = await openExtensionsSettings(page);
	const row = section.getByTestId("extension-row-hint-mode");
	await expect(row).toContainText("Hint mode");
	await expect(row.locator('[data-testid^="extension-tool-"]')).toHaveCount(0);
	await expect(row.getByTestId(HINT_TOGGLE)).toHaveAttribute("aria-checked", "true");
	await closeSettings(page);

	const cheatsheetRow = page.locator('[data-shortcut="hint-mode.show"]');
	const openCheatsheet = async () => {
		await page.getByTestId("left-layout-rail").getByTestId("open-shortcuts").click();
		await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
	};
	await openCheatsheet();
	await expect(cheatsheetRow).toContainText("F");
	await page.keyboard.press("Escape");

	await setHintMode(page, false);
	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await pressPlatformShortcut(page, ";");
	await expect(overlay(page)).toHaveCount(0);
	await openCheatsheet();
	await expect(cheatsheetRow).toHaveCount(0);
	await page.keyboard.press("Escape");

	await setHintMode(page, true);
	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await expect(overlay(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await openCheatsheet();
	await expect(cheatsheetRow).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
});
