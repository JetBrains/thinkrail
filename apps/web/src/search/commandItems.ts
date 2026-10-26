import type { Translator } from "@thinkrail/locales/react";
import {
	COMMAND_GROUP_LABELS,
	type Command,
	type CommandContext,
	isCommandEnabled,
	visibleCommands,
} from "../commands";
import type { PaletteItem } from "./model";

export function commandItems(
	t: Translator,
	commands: readonly Command[],
	context: CommandContext,
): PaletteItem[] {
	return visibleCommands(commands, context).map((command) => ({
		id: `command:${command.id}`,
		kind: "command",
		title: command.title,
		subtitle: t(COMMAND_GROUP_LABELS[command.group]),
		group: command.group === "settings" ? "settings" : "commands",
		scope: "commands",
		icon: command.icon,
		...(command.keywords ? { keywords: command.keywords } : {}),
		...(command.shortcut ? { shortcut: command.shortcut } : {}),
		...(isCommandEnabled(command, context)
			? {}
			: { disabledReason: t("search.palette.offlineReason") }),
		run: () => command.run(context),
	}));
}
