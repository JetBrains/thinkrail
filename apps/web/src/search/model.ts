import type { RemixiconComponentType } from "@remixicon/react";
import type { CommandShortcut } from "../commands";
import type { SessionAttention } from "../store";
import type { SearchScope } from "./query";

export type PaletteItemKind =
	| "command"
	| "setting"
	| "project"
	| "workspace"
	| "chat"
	| "mcp"
	| "extension"
	| "model"
	| "theme"
	| "filter"
	| "more";

export type WorkState = "waiting" | "error" | "unread" | "running";

export type PaletteMore =
	| { readonly kind: "scope"; readonly scope: SearchScope }
	| { readonly kind: "expand"; readonly group: string; readonly nextId: string };

export interface PaletteToggle {
	readonly on: boolean;
	readonly set: (on: boolean) => void;
}

export interface PaletteAction {
	readonly id: string;
	readonly title: string;
	readonly icon: RemixiconComponentType;
	readonly shortcut?: CommandShortcut;
	readonly danger?: boolean;
	readonly disabledReason?: string;
	readonly run: () => void;
}

export interface PalettePreview {
	readonly title: string;
	readonly subtitle?: string;
	readonly fields: readonly (readonly [label: string, value: string])[];
	readonly body?: string;
}

export interface PaletteItem {
	readonly id: string;
	readonly kind: PaletteItemKind;
	readonly title: string;
	readonly group: string;
	readonly scope: SearchScope;
	readonly icon: RemixiconComponentType;
	readonly subtitle?: string;
	readonly keywords?: readonly string[];
	readonly running?: boolean;
	readonly attention?: SessionAttention;
	readonly states?: readonly WorkState[];
	readonly badge?: string;
	readonly meta?: string;
	readonly shortcut?: CommandShortcut;
	readonly projectId?: string;
	readonly workspaceId?: string;
	readonly sessionId?: string;
	readonly settled?: boolean;
	readonly hasPr?: boolean;
	readonly contextBoost?: number;
	readonly disabledReason?: string;
	readonly toggle?: PaletteToggle;
	readonly page?: string;
	readonly more?: PaletteMore;
	readonly fillQuery?: string;
	readonly run?: () => void;
	readonly actions?: () => readonly PaletteAction[];
	readonly preview?: () => PalettePreview | null;
}

export interface PaletteSection {
	readonly id: string;
	readonly title: string;
	readonly meta?: string;
	readonly items: readonly PaletteRow[];
}

export interface PaletteRow {
	readonly item: PaletteItem;
	readonly ranges: Readonly<Record<string, readonly (readonly [number, number])[]>>;
	readonly top?: boolean;
}
