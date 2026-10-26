import type { RemixiconComponentType } from "@remixicon/react";
import type { MatchField, MatchRange, SearchPreviewTarget } from "@thinkrail/contracts";
import type { CommandShortcut } from "../commands";
import type { ChatTitleSource } from "../lib";
import type { SessionAttention } from "../store";
import type { SearchScope } from "./query";

export type PaletteItemKind =
	| "command"
	| "setting"
	| "project"
	| "workspace"
	| "chat"
	| "file"
	| "spec"
	| "plan"
	| "transcript"
	| "start"
	| "more";

export type PaletteMore =
	| { readonly kind: "scope"; readonly scope: SearchScope }
	| { readonly kind: "expand"; readonly group: string; readonly nextId: string };

export interface PalettePreview {
	readonly title: string;
	readonly subtitle?: string;
	readonly fields: readonly (readonly [label: string, value: string])[];
}

export interface PaletteFile {
	readonly workspaceId: string;
	readonly path: string;
	readonly size?: number;
}

export interface PaletteMatch {
	readonly tier: number;
	readonly score: number;
	readonly ranges: Readonly<Record<string, readonly MatchRange[]>>;
}

export interface PaletteItem {
	readonly id: string;
	readonly kind: PaletteItemKind;
	readonly title: string;
	readonly group: string;
	readonly scope: SearchScope;
	readonly icon: RemixiconComponentType;
	readonly subtitle?: string;
	readonly titleSource?: ChatTitleSource;
	readonly titleTooltip?: string;
	readonly keywords?: readonly string[];
	readonly running?: boolean;
	readonly attention?: SessionAttention;
	readonly badge?: string;
	readonly shortcut?: CommandShortcut;
	readonly projectId?: string;
	readonly workspaceId?: string;
	readonly sessionId?: string;
	readonly contextBoost?: number;
	readonly match?: PaletteMatch;
	readonly late?: number;
	readonly hostFields?: readonly MatchField[];
	readonly previewTarget?: SearchPreviewTarget;
	readonly file?: PaletteFile;
	readonly disabledReason?: string;
	readonly more?: PaletteMore;
	readonly run?: () => void;
	readonly preview?: () => PalettePreview | null;
}

/** Start work from the typed text: the shell opens its Create-workspace dialog with the text as the prompt. */
export interface PaletteStart {
	readonly openDialog: (text: string) => void;
	readonly disabledReason?: string;
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
