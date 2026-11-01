import type { MessageKey } from "@thinkrail/locales";
import { platformFamily } from "../lib";
import type { Command, CommandGroup, CommandShortcut } from "./types";

export const COMMAND_GROUP_LABELS = {
	work: "commands.group.work",
	navigation: "commands.group.navigation",
	workspace: "commands.group.workspace",
	view: "commands.group.view",
	settings: "commands.group.settings",
} as const satisfies Record<CommandGroup, MessageKey>;

export function isCommandEnabled(command: Command, online: boolean): boolean {
	return !command.mutates || online;
}

export function shortcutKeys(shortcut: CommandShortcut, platform?: string): string[] {
	const apple = platformFamily(platform) === "apple";
	const keys: string[] = [];
	if (apple) {
		if (shortcut.ctrl) keys.push("⌃");
		if (shortcut.alt) keys.push("⌥");
		if (shortcut.shift) keys.push("⇧");
		if (shortcut.mod) keys.push("⌘");
	} else {
		if (shortcut.mod || shortcut.ctrl) keys.push("Ctrl");
		if (shortcut.alt) keys.push("Alt");
		if (shortcut.shift) keys.push("Shift");
	}
	keys.push(shortcut.key);
	return keys;
}
