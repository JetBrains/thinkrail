import type { ApplicationMenuItemConfig } from "electrobun/bun";

type ApplicationMenuApi = {
	setApplicationMenu(menu: ApplicationMenuItemConfig[]): void;
};

function editMenu(): ApplicationMenuItemConfig {
	return {
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
}

export function desktopApplicationMenu(
	platform: NodeJS.Platform,
): ApplicationMenuItemConfig[] | null {
	if (platform === "win32") return [editMenu()];
	if (platform !== "darwin") return null;
	return [
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
		editMenu(),
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
	];
}

export function installDesktopApplicationMenu(
	applicationMenu: ApplicationMenuApi,
	platform: NodeJS.Platform,
): boolean {
	const menu = desktopApplicationMenu(platform);
	if (!menu) return false;
	applicationMenu.setApplicationMenu(menu);
	return true;
}
