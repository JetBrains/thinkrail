import { expect, test } from "bun:test";
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { desktopApplicationMenu, installDesktopApplicationMenu } from "./applicationMenu";

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
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "showAll" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		editMenu,
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ role: "close" },
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
