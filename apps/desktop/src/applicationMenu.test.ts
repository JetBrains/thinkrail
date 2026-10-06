import { expect, test } from "bun:test";
import type { ApplicationMenuItemConfig } from "electrobun/main";
import {
	desktopApplicationMenu,
	installDesktopApplicationMenu,
	isNativeCommand,
	QUIT_SHORTCUT_ACTION,
	readMenuAction,
} from "./applicationMenu";

const editMenu: ApplicationMenuItemConfig = {
	label: "Edit",
	submenu: [
		{ role: "undo" },
		{ role: "redo" },
		{ type: "separator" },
		{ role: "cut" },
		{ role: "copy" },
		{ role: "paste" },
		{ role: "pasteAndMatchStyle" },
		{ role: "delete" },
		{ role: "selectAll" },
	],
};

test("builds the native macOS application, edit, and window menus", () => {
	expect(desktopApplicationMenu("darwin")).toEqual([
		{
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "hide", accelerator: "CommandOrControl+H" },
				{ role: "hideOthers", accelerator: "CommandOrControl+Alt+H" },
				{ role: "showAll" },
				{ type: "separator" },
				{
					label: "Quit ThinkRail",
					action: QUIT_SHORTCUT_ACTION,
					accelerator: "CommandOrControl+Q",
				},
			],
		},
		editMenu,
		{
			label: "Window",
			submenu: [
				{ role: "minimize", accelerator: "CommandOrControl+M" },
				{ role: "zoom" },
				{ label: "Close", action: "close-item", accelerator: "CommandOrControl+W" },
				{ type: "separator" },
				{ role: "bringAllToFront" },
			],
		},
	]);
});

test("builds the supported Windows edit menu and skips Linux", () => {
	expect(desktopApplicationMenu("win32")).toEqual([editMenu]);
	expect(desktopApplicationMenu("linux")).toBeNull();
});

test("registers the menu exactly once on supported platforms", () => {
	const calls: ApplicationMenuItemConfig[][] = [];
	const applicationMenu = {
		setApplicationMenu(menu: ApplicationMenuItemConfig[]) {
			calls.push(menu);
		},
	};
	const darwinMenu = desktopApplicationMenu("darwin");
	if (!darwinMenu) throw new Error("macOS application menu is missing");

	expect(installDesktopApplicationMenu(applicationMenu, "darwin")).toBe(true);
	expect(calls).toEqual([darwinMenu]);
	calls.length = 0;
	expect(installDesktopApplicationMenu(applicationMenu, "linux")).toBe(false);
	expect(calls).toEqual([]);
});

test("reads the action from an application-menu-clicked event", () => {
	expect(readMenuAction({ data: { id: 3, action: QUIT_SHORTCUT_ACTION } })).toBe(
		QUIT_SHORTCUT_ACTION,
	);
	expect(readMenuAction({ data: { action: 7 } })).toBeNull();
	expect(readMenuAction({ data: null })).toBeNull();
	expect(readMenuAction(undefined)).toBeNull();
});

test("recognizes forwarded native commands only", () => {
	expect(isNativeCommand("close-item")).toBe(true);
	expect(isNativeCommand(QUIT_SHORTCUT_ACTION)).toBe(false);
	expect(isNativeCommand(null)).toBe(false);
	expect(isNativeCommand("toString")).toBe(false);
});
