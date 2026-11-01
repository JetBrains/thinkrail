import type { RemixiconComponentType } from "@remixicon/react";

export type CommandGroup = "work" | "navigation" | "workspace" | "view" | "settings";

export interface CommandShortcut {
	readonly key: string;
	readonly mod?: boolean;
	readonly alt?: boolean;
	readonly shift?: boolean;
	readonly ctrl?: boolean;
}

export interface Command {
	readonly id: string;
	readonly title: string;
	readonly group: CommandGroup;
	readonly icon: RemixiconComponentType;
	readonly keywords?: readonly string[];
	readonly shortcut?: CommandShortcut;
	readonly mutates?: boolean;
	readonly disabledReason?: string;
	readonly run: () => void;
}
