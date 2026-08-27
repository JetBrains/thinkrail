import type { SlashCommandInfo } from "@thinkrail/contracts";
import type { SlashCommandItem } from "./SlashCommandCompletion";

const COMPACT_NAME = "compact";

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
];

export interface CompactChatCommand {
	kind: "compact";
	instructions?: string;
}

export function parseNativeChatCommand(text: string): CompactChatCommand | null {
	if (text === "/compact") return { kind: "compact" };
	if (!text.startsWith("/compact ")) return null;
	const instructions = text.slice(9).trim();
	return instructions ? { kind: "compact", instructions } : { kind: "compact" };
}

export function mergeNativeChatCommands(commands: readonly SlashCommandInfo[]): SlashCommandItem[] {
	return [...NATIVE_CHAT_COMMANDS, ...commands.filter((command) => command.name !== COMPACT_NAME)];
}
