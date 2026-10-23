import type { MessageKey } from "@thinkrail/locales";
import { platformFamily } from "../lib";
import type { Command, CommandContext, CommandGroup, CommandShortcut } from "./types";

export const COMMAND_GROUP_LABELS = {
	work: "commands.group.work",
	navigation: "commands.group.navigation",
	workspace: "commands.group.workspace",
	chat: "commands.group.chat",
	view: "commands.group.view",
	settings: "commands.group.settings",
} as const satisfies Record<CommandGroup, MessageKey>;

export function isCommandVisible(command: Command, context: CommandContext): boolean {
	return command.when?.(context) ?? true;
}

export function isCommandEnabled(command: Command, context: CommandContext): boolean {
	return !command.mutates || context.online;
}

export function visibleCommands(commands: readonly Command[], context: CommandContext): Command[] {
	return commands.filter((command) => isCommandVisible(command, context));
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

export function shortcutLabel(shortcut: CommandShortcut, platform?: string): string {
	const keys = shortcutKeys(shortcut, platform);
	return platformFamily(platform) === "apple" ? keys.join("") : keys.join("+");
}
