import type { SlashCommandInfo } from "@thinkrail/contracts";
import { type Translator, t as translate } from "@thinkrail/locales/react";
import type { SlashCommandItem } from "@/prompt";
import { type PreparedChatTitle, prepareChatTitle } from "./chatTitle";

const COMPACT_NAME = "compact";
const NAME_NAME = "name";
const MODEL_NAME = "model";

export function compactSubmissionError(
	hasDraftImages: boolean,
	hasQueuedImages: boolean,
): string | null {
	if (hasDraftImages) return translate("chat.commands.compactImageError");
	return hasQueuedImages ? translate("chat.commands.compactQueuedImageError") : null;
}

export const nativeChatCommands = (t: Translator): readonly SlashCommandItem[] => [
	{
		name: COMPACT_NAME,
		description: t("chat.commands.compactDescription"),
		source: "builtin",
		sourceInfo: {
			path: "<builtin:compact>",
			source: "pi",
			scope: "temporary",
			origin: "top-level",
		},
	},
	{
		name: NAME_NAME,
		description: t("chat.commands.nameDescription"),
		source: "builtin",
		sourceInfo: {
			path: "<builtin:name>",
			source: "pi",
			scope: "temporary",
			origin: "top-level",
		},
	},
	{
		name: MODEL_NAME,
		description: t("chat.commands.modelDescription"),
		source: "builtin",
		sourceInfo: {
			path: "<builtin:model>",
			source: "pi",
			scope: "temporary",
			origin: "top-level",
		},
	},
];

export function isModelCommand(command: Pick<SlashCommandItem, "name" | "source">): boolean {
	return command.source === "builtin" && command.name === MODEL_NAME;
}

/** `/model [query]` → the picker search to open with; `null` for anything else. */
export function parseModelCommand(text: string): string | null {
	if (text === `/${MODEL_NAME}`) return "";
	return text.startsWith(`/${MODEL_NAME} `) ? text.slice(MODEL_NAME.length + 2).trim() : null;
}

export interface CompactChatCommand {
	kind: "compact";
	instructions?: string;
}

export interface NameChatCommand {
	kind: "name";
	title: string;
}

export type NativeChatCommand = CompactChatCommand | NameChatCommand;

export function parseNativeChatCommand(
	text: string,
	supportsSessionRename = false,
): NativeChatCommand | null {
	if (text === "/compact") return { kind: "compact" };
	if (text.startsWith("/compact ")) {
		const instructions = text.slice(9).trim();
		return instructions ? { kind: "compact", instructions } : { kind: "compact" };
	}
	if (!supportsSessionRename) return null;
	if (text === "/name") return { kind: "name", title: "" };
	return text.startsWith("/name ") ? { kind: "name", title: text.slice(6) } : null;
}

export function prepareNameChatCommand(titleInput: string, hasImages: boolean): PreparedChatTitle {
	return hasImages
		? { reason: translate("chat.commands.nameImageError") }
		: prepareChatTitle(titleInput);
}

export function mergeNativeChatCommands(
	t: Translator,
	commands: readonly SlashCommandInfo[],
	supportsSessionRename = false,
): SlashCommandItem[] {
	const all = nativeChatCommands(t);
	const native = supportsSessionRename ? all : all.filter((command) => command.name !== NAME_NAME);
	const reserved = new Set(native.map((command) => command.name));
	return [...native, ...commands.filter((command) => !reserved.has(command.name))];
}
