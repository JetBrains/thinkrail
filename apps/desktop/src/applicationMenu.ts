import type { NativeCommand } from "@thinkrail/contracts";
import type { ApplicationMenuItemConfig } from "electrobun/main";

export const QUIT_SHORTCUT_ACTION = "quit-shortcut";
const CLOSE_ITEM_COMMAND: NativeCommand = "close-item";
const OPEN_SETTINGS_COMMAND: NativeCommand = "open-settings";
const NATIVE_COMMANDS = { "close-item": true, "open-settings": true } satisfies Record<
	NativeCommand,
	true
>;

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
				{
					label: "Settings…",
					action: OPEN_SETTINGS_COMMAND,
					accelerator: "CommandOrControl+,",
				},
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
		editMenu(),
		{
			label: "Window",
			submenu: [
				{ role: "minimize", accelerator: "CommandOrControl+M" },
				{ role: "zoom" },
				{ label: "Close", action: CLOSE_ITEM_COMMAND, accelerator: "CommandOrControl+W" },
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

export function isNativeCommand(action: string | null): action is NativeCommand {
	return action !== null && Object.hasOwn(NATIVE_COMMANDS, action);
}

export function readMenuAction(event: unknown) {
	if (typeof event !== "object" || event === null) return null;
	const data: unknown = Reflect.get(event, "data");
	if (typeof data !== "object" || data === null) return null;
	const action: unknown = Reflect.get(data, "action");
	return typeof action === "string" ? action : null;
}
