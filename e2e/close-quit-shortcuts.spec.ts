import { expect, type Page, test } from "@playwright/test";
import type { NativeCommand, NativeQuitHint, NativeShortcutsBridge } from "@thinkrail/contracts";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	runInTerminal,
	visibleTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
} from "./fixtures/app";

interface ShortcutsStub {
	hint(hint: NativeQuitHint): void;
	command(command: NativeCommand): void;
	quits: number;
	closeRequests: number;
	rejectQuit: boolean;
}

declare global {
	interface Window {
		__e2eShortcuts: ShortcutsStub;
	}
}

function installNativeShortcuts(page: Page, platform: string) {
	return page.addInitScript((navigatorPlatform) => {
		Object.defineProperty(Navigator.prototype, "platform", { get: () => navigatorPlatform });
		const hintListeners = new Set<(hint: NativeQuitHint) => void>();
		const commandListeners = new Set<(command: NativeCommand) => void>();
		const stub: ShortcutsStub = {
			hint: (hint) => {
				for (const listener of hintListeners) listener(hint);
			},
			command: (command) => {
				for (const listener of commandListeners) listener(command);
			},
			quits: 0,
			closeRequests: 0,
			rejectQuit: false,
		};
		window.__e2eShortcuts = stub;
		const bridge: NativeShortcutsBridge = Object.freeze({
			subscribeQuitHint: (listener: (hint: NativeQuitHint) => void) => {
				hintListeners.add(listener);
				return () => hintListeners.delete(listener);
			},
			subscribeCommand: (listener: (command: NativeCommand) => void) => {
				commandListeners.add(listener);
				return () => commandListeners.delete(listener);
			},
			quit: async () => {
				stub.quits += 1;
				if (stub.rejectQuit) throw new Error("quit refused");
			},
		});
		Reflect.set(window, "__THINKRAIL_NATIVE_SHORTCUTS__", bridge);
	}, platform);
}

function closeItem(page: Page) {
	return page.evaluate(() => window.__e2eShortcuts.command("close-item"));
}

function quitCount(page: Page) {
	return page.evaluate(() => window.__e2eShortcuts.quits);
}

function editorTabs(page: Page) {
	return page.locator('[data-testid="editor-tab"]:not([data-kind="chat"])');
}

async function openTwoFileTabs(page: Page): Promise<void> {
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await chatTab.hover();
	await chatTab.getByTestId("editor-tab-close").click();
	await expect(chatTab).toHaveCount(0);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await expect(editorTabs(page)).toHaveCount(2);
}

async function focusEditorTab(page: Page, name: string): Promise<void> {
	await editorTabs(page).filter({ hasText: name }).getByRole("tab").click();
	await expect(editorTabs(page).filter({ hasText: name })).toHaveAttribute("data-active", "true");
}

test("native close-item closes the top layer first, then the focused tab", async ({ page }) => {
	await installNativeShortcuts(page, "MacIntel");
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await page.getByTestId("chat-input").press("Control+r");
	await expect(page.getByTestId("history-overlay")).toBeVisible();
	await closeItem(page);
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
	await expect(chatTab).toHaveCount(1);

	await chatTab.getByRole("tab").click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await pressPlatformShortcut(page, "n");
	await expect(dialog).toBeVisible();
	await closeItem(page);
	await expect(dialog).toBeHidden();
	await expect(chatTab).toHaveCount(1);

	await openTwoFileTabs(page);
	await focusEditorTab(page, "README.md");
	await closeItem(page);
	await expect(editorTabs(page)).toHaveCount(1);
	await expect(editorTabs(page).filter({ hasText: "README.md" })).toHaveCount(0);

	await waitTerminalReady(page);
	await runInTerminal(page, "sh -c 'echo TR_$((40+2)); exec sleep 45'");
	await expect(visibleTerminalScreen(page)).toContainText("TR_42");
	await closeItem(page);
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await closeItem(page);
	await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
});

test("native close-item never closes a session through a tool-window rail", async ({ page }) => {
	await installNativeShortcuts(page, "MacIntel");
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await waitTerminalReady(page);
	await page.getByTestId("tool-rail-files").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New bottom group at right", exact: true }).click();
	await waitTerminalReady(page);
	const terminalKey = await visibleTerminal(page).getAttribute("data-tab-key");
	await page.evaluate(() => {
		const send = WebSocket.prototype.send;
		WebSocket.prototype.send = function (data) {
			if (typeof data === "string" && JSON.parse(data).method === "terminal.close")
				window.__e2eShortcuts.closeRequests += 1;
			send.call(this, data);
		};
	});
	for (const control of [
		page.getByTestId("tool-rail-files"),
		page.getByTestId("terminal-rail-group"),
	]) {
		await control.focus();
		await closeItem(page);
		expect(await page.evaluate(() => window.__e2eShortcuts.closeRequests)).toBe(0);
		await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
		await expect(visibleTerminal(page)).toHaveAttribute("data-tab-key", terminalKey ?? "");
		await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
	}
	await page.getByTestId("terminal-tab").getByRole("tab").focus();
	await closeItem(page);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
	expect(await page.evaluate(() => window.__e2eShortcuts.closeRequests)).toBe(1);
});

test("Windows Ctrl+W and Ctrl+F4 close the focused tab; a terminal keeps Ctrl+W", async ({
	page,
}) => {
	await installNativeShortcuts(page, "Win32");
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await openTwoFileTabs(page);

	await focusEditorTab(page, "notes.txt");
	await page.keyboard.press("Control+w");
	await expect(editorTabs(page)).toHaveCount(1);
	await expect(editorTabs(page).filter({ hasText: "notes.txt" })).toHaveCount(0);
	await focusEditorTab(page, "README.md");
	await page.keyboard.press("Control+F4");
	await expect(editorTabs(page)).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Empty center group" })).toBeFocused();

	await waitTerminalReady(page);
	const terminalInput = visibleTerminal(page).locator(".xterm-helper-textarea");
	await terminalInput.focus();
	await expect(terminalInput).toBeFocused();
	await page.keyboard.type("echo TR_$((40+2)) drop");
	await page.keyboard.press("Control+w");
	await page.keyboard.press("Enter");
	await expect(visibleTerminalScreen(page)).toContainText("TR_42");
	await expect(visibleTerminalScreen(page)).not.toContainText("drop");
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(terminalInput).toBeFocused();
	await page.keyboard.press("Control+F4");
	await expect(page.getByTestId("terminal-tab")).toHaveCount(0);
});

test("Linux Ctrl+Q quits on a confirmed double press and a tap only hints", async ({ page }) => {
	await installNativeShortcuts(page, "Linux x86_64");
	await openAppFresh(page);
	const hint = page.getByTestId("quit-hint");
	await page.locator("body").click();

	await page.keyboard.press("Control+q");
	await expect(hint).toHaveText("Hold Ctrl+Q or press twice to quit");
	await expect(hint).toHaveAttribute("data-hint", "hidden");
	expect(await quitCount(page)).toBe(0);

	await page.keyboard.down("Control");
	await page.keyboard.press("q");
	await page.keyboard.down("q");
	await expect(hint).toHaveText("Release to quit");
	expect(await quitCount(page)).toBe(0);
	await page.keyboard.up("q");
	await page.keyboard.up("Control");
	await expect.poll(() => quitCount(page)).toBe(1);
	await expect(hint).toHaveText("Quitting…");
});

test("the overlay follows native hints and a refused quit re-arms", async ({ page }) => {
	await installNativeShortcuts(page, "Linux x86_64");
	await openAppFresh(page);
	const hint = page.getByTestId("quit-hint");
	await expect(hint).toHaveAttribute("data-hint", "hidden");

	for (const [native, text] of [
		["armed", "Hold Ctrl+Q or press twice to quit"],
		["release", "Release to quit"],
	] as const) {
		await page.evaluate((next) => window.__e2eShortcuts.hint(next), native);
		await expect(hint).toHaveAttribute("data-hint", native);
		await expect(hint).toHaveText(text);
	}
	await page.evaluate(() => window.__e2eShortcuts.hint("hidden"));
	await expect(hint).toHaveAttribute("data-hint", "hidden");
	await expect(hint).toHaveCSS("opacity", "0");

	await page.evaluate(() => {
		window.__e2eShortcuts.rejectQuit = true;
	});
	await page.locator("body").click();
	await page.keyboard.press("Control+q");
	await page.keyboard.press("Control+q");
	await expect.poll(() => quitCount(page)).toBe(1);
	await expect(hint).toHaveAttribute("data-hint", "hidden");
	await page.keyboard.press("Control+q");
	await expect(hint).toHaveAttribute("data-hint", "armed");
});
