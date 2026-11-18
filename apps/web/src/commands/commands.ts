import type { MessageKey } from "@thinkrail/locales";
import { chordCaps } from "@thinkrail/ui/keyboard";
import type { Command, CommandGroup, CommandShortcut } from "./types";

export const COMMAND_GROUP_LABELS = {
	work: "commands.group.work",
	navigation: "commands.group.navigation",
	workspace: "commands.group.workspace",
	tab: "commands.group.tab",
	view: "commands.group.view",
	settings: "commands.group.settings",
} as const satisfies Record<CommandGroup, MessageKey>;

export function isCommandEnabled(command: Command, online: boolean): boolean {
	return !command.mutates || online;
}

export function shortcutKeys(shortcut: CommandShortcut, platform?: string): string[] {
	return chordCaps(shortcut, platform);
}
