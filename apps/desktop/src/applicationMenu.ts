import type { NativeCommand } from "@thinkrail/contracts";
import { DESKTOP_MENU_KEYS, EN } from "@thinkrail/locales";
import type { ApplicationMenuItemConfig } from "electrobun/main";

const MENU_LABEL_KEYS = DESKTOP_MENU_KEYS;
const MAX_MENU_LABEL_LENGTH = 80;

export type DesktopMenuLabels = Readonly<Record<(typeof MENU_LABEL_KEYS)[number], string>>;

export const DEFAULT_MENU_LABELS: DesktopMenuLabels = Object.fromEntries(
	MENU_LABEL_KEYS.map((key) => [key, EN[key] ?? key]),
) as DesktopMenuLabels;

export function readMenuLabels(raw: unknown): DesktopMenuLabels {
	const source = typeof raw === "object" && raw !== null ? raw : {};
	return Object.fromEntries(
		MENU_LABEL_KEYS.map((key) => {
			const value: unknown = Reflect.get(source, key);
			return [
				key,
				typeof value === "string" && value.trim() && value.length <= MAX_MENU_LABEL_LENGTH
					? value
					: DEFAULT_MENU_LABELS[key],
			];
		}),
	) as DesktopMenuLabels;
}

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

function editMenu(labels: DesktopMenuLabels): ApplicationMenuItemConfig {
	return {
		label: labels["desktop.menu.edit"],
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
	labels: DesktopMenuLabels = DEFAULT_MENU_LABELS,
): ApplicationMenuItemConfig[] | null {
	if (platform === "win32") return [editMenu(labels)];
	if (platform !== "darwin") return null;
	return [
		{
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{
					label: labels["desktop.menu.settings"],
					action: OPEN_SETTINGS_COMMAND,
					accelerator: "CommandOrControl+,",
				},
				{ type: "separator" },
				{ role: "hide", accelerator: "CommandOrControl+H" },
				{ role: "hideOthers", accelerator: "CommandOrControl+Alt+H" },
				{ role: "showAll" },
				{ type: "separator" },
				{
					label: labels["desktop.menu.quit"],
					action: QUIT_SHORTCUT_ACTION,
					accelerator: "CommandOrControl+Q",
				},
			],
		},
		editMenu(labels),
		{
			label: labels["desktop.menu.window"],
			submenu: [
				{ role: "minimize", accelerator: "CommandOrControl+M" },
				{ role: "zoom" },
				{
					label: labels["desktop.menu.close"],
					action: CLOSE_ITEM_COMMAND,
					accelerator: "CommandOrControl+W",
				},
				{ type: "separator" },
				{ role: "bringAllToFront" },
			],
		},
	];
}

export function installDesktopApplicationMenu(
	applicationMenu: ApplicationMenuApi,
	platform: NodeJS.Platform,
	labels: DesktopMenuLabels = DEFAULT_MENU_LABELS,
): boolean {
	const menu = desktopApplicationMenu(platform, labels);
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
