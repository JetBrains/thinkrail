import type { SlashCommandInfo } from "@thinkrail/contracts";
import type { SlashCommandItem } from "@/prompt";
import { type PreparedChatTitle, prepareChatTitle } from "./chatTitle";

const COMPACT_NAME = "compact";
const NAME_NAME = "name";

export const COMPACT_IMAGE_ERROR = "Remove images to use /compact";
export const COMPACT_QUEUED_IMAGE_ERROR =
	"Wait for queued image messages to send before using /compact";

export function compactSubmissionError(
	hasDraftImages: boolean,
	hasQueuedImages: boolean,
): string | null {
	if (hasDraftImages) return COMPACT_IMAGE_ERROR;
	return hasQueuedImages ? COMPACT_QUEUED_IMAGE_ERROR : null;
}

export const NATIVE_CHAT_COMMANDS: readonly SlashCommandItem[] = [
	{
		name: COMPACT_NAME,
		description: "Manually compact context · optional instructions",
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
		description: "Rename this chat · requires a title",
		source: "builtin",
		sourceInfo: {
			path: "<builtin:name>",
			source: "pi",
			scope: "temporary",
			origin: "top-level",
		},
	},
];

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
	return hasImages ? { reason: "Remove images to use /name" } : prepareChatTitle(titleInput);
}

export function mergeNativeChatCommands(
	commands: readonly SlashCommandInfo[],
	supportsSessionRename = false,
): SlashCommandItem[] {
	const native = supportsSessionRename
		? NATIVE_CHAT_COMMANDS
		: NATIVE_CHAT_COMMANDS.filter((command) => command.name !== NAME_NAME);
	const reserved = new Set(native.map((command) => command.name));
	return [...native, ...commands.filter((command) => !reserved.has(command.name))];
}
