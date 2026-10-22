import type { RemixiconComponentType } from "@remixicon/react";

export const COMMAND_GROUPS = [
	"work",
	"navigation",
	"workspace",
	"chat",
	"view",
	"settings",
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface CommandShortcut {
	readonly key: string;
	readonly mod?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly ctrl?: boolean;
}

export interface CommandContext {
	readonly online: boolean;
	readonly projectId: string | null;
	readonly workspaceId: string | null;
	readonly protocolVersion: number | null;
}

export interface Command {
	readonly id: string;
	readonly title: string;
	readonly group: CommandGroup;
	readonly icon: RemixiconComponentType;
	readonly keywords?: readonly string[];
	readonly shortcut?: CommandShortcut;
	readonly mutates?: boolean;
	readonly page?: string;
	readonly when?: (context: CommandContext) => boolean;
	readonly run?: (context: CommandContext) => void;
}
