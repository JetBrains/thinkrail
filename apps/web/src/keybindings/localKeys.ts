import type { MessageKey } from "@thinkrail/locales";
import {
	ARROW_TWIN_COMMANDS,
	ARROW_TWINS_SCOPE,
	type LocalKeyCommand,
} from "@thinkrail/ui/keyboard";
import { READING_COMMANDS, READING_SCOPE } from "@thinkrail/ui/reading";
import type { PhysicalChord } from "./keybindings";

export interface LocalScopeInfo {
	readonly where: MessageKey;
	readonly inside: MessageKey;
	readonly includes?: readonly string[];
	readonly extendsWithShift?: boolean;
}

const ARROWS = [ARROW_TWINS_SCOPE] as const;

export const LOCAL_SCOPES = {
	[ARROW_TWINS_SCOPE]: {
		where: "shortcuts.scope.arrows.where",
		inside: "shortcuts.scope.arrows.inside",
	},
	[READING_SCOPE]: {
		where: "shortcuts.scope.reading.where",
		inside: "shortcuts.scope.reading.inside",
	},
	tabs: {
		where: "shortcuts.scope.tabs.where",
		inside: "shortcuts.scope.tabs.inside",
		includes: ARROWS,
	},
	rails: {
		where: "shortcuts.scope.rails.where",
		inside: "shortcuts.scope.rails.inside",
		includes: ARROWS,
	},
	trees: {
		where: "shortcuts.scope.trees.where",
		inside: "shortcuts.scope.trees.inside",
		includes: ARROWS,
	},
	review: { where: "shortcuts.scope.review.where", inside: "shortcuts.scope.review.inside" },
	"review.surface": {
		where: "shortcuts.scope.reviewSurface.where",
		inside: "shortcuts.scope.reviewSurface.inside",
		includes: ARROWS,
		extendsWithShift: true,
	},
	transcript: {
		where: "shortcuts.scope.transcript.where",
		inside: "shortcuts.scope.transcript.inside",
		includes: [ARROW_TWINS_SCOPE, READING_SCOPE],
	},
	reader: {
		where: "shortcuts.scope.reader.where",
		inside: "shortcuts.scope.reader.inside",
		includes: [ARROW_TWINS_SCOPE, READING_SCOPE],
	},
	composer: {
		where: "shortcuts.scope.composer.where",
		inside: "shortcuts.scope.composer.inside",
	},
	history: { where: "shortcuts.scope.history.where", inside: "shortcuts.scope.history.inside" },
	palette: { where: "shortcuts.scope.palette.where", inside: "shortcuts.scope.palette.inside" },
	findInFiles: {
		where: "shortcuts.scope.findInFiles.where",
		inside: "shortcuts.scope.findInFiles.inside",
	},
	"settings.nav": {
		where: "shortcuts.scope.settingsNav.where",
		inside: "shortcuts.scope.settingsNav.inside",
		includes: ARROWS,
	},
	settings: {
		where: "shortcuts.scope.settings.where",
		inside: "shortcuts.scope.settings.inside",
		includes: ARROWS,
	},
	"settings.list": {
		where: "shortcuts.scope.settingsList.where",
		inside: "shortcuts.scope.settingsList.inside",
		includes: ARROWS,
	},
} as const satisfies Record<string, LocalScopeInfo>;

export type AppLocalScope = keyof typeof LOCAL_SCOPES;

export interface LocalCommandDefaults {
	readonly id: string;
	readonly scope: string;
	readonly title: MessageKey | null;
	readonly chords: readonly PhysicalChord[];
}

export interface LocalScopeDeclaration {
	readonly id: string;
	readonly includes?: readonly string[];
	readonly extendsWithShift?: boolean;
}

const local = (
	scope: AppLocalScope,
	action: string,
	...chords: PhysicalChord[]
): LocalCommandDefaults => ({ id: `${scope}.${action}`, scope, title: null, chords });

const ENTER = { code: "Enter", key: "↵" } as const;
const NUMPAD_ENTER = { code: "NumpadEnter", key: "Num ↵" } as const;
const DELETE = { code: "Delete", key: "Delete" } as const;
const MOVE = { alt: true, shift: true } as const;
const UP = { code: "ArrowUp", key: "↑" } as const;
const DOWN = { code: "ArrowDown", key: "↓" } as const;
const LEFT = { code: "ArrowLeft", key: "←" } as const;
const RIGHT = { code: "ArrowRight", key: "→" } as const;
const enter = (modifiers: Omit<PhysicalChord, "code" | "key">): PhysicalChord[] => [
	{ ...ENTER, ...modifiers },
	{ ...NUMPAD_ENTER, ...modifiers },
];
const letter = (key: string, modifiers: Omit<PhysicalChord, "code" | "key"> = {}) => ({
	code: `Key${key}`,
	key,
	...modifiers,
});

export const APP_LOCAL_COMMANDS: readonly LocalCommandDefaults[] = [
	...ARROW_TWIN_COMMANDS.map(({ id, chords }) => ({
		id,
		scope: ARROW_TWINS_SCOPE,
		title: null,
		chords,
	})),
	...READING_COMMANDS.map(({ id, chords }) => ({ id, scope: READING_SCOPE, title: null, chords })),
	local("tabs", "close", DELETE),
	local("tabs", "moveBefore", { ...LEFT, ...MOVE }),
	local("tabs", "moveAfter", { ...RIGHT, ...MOVE }),
	local("rails", "remove", DELETE),
	local("rails", "moveUp", { ...UP, ...MOVE }),
	local("rails", "moveDown", { ...DOWN, ...MOVE }),
	local("rails", "moveLeft", { ...LEFT, ...MOVE }),
	local("rails", "moveRight", { ...RIGHT, ...MOVE }),
	local("trees", "search", letter("S")),
	local("trees", "openKept", ...enter({ mod: true })),
	local("trees", "rename", { code: "F2", key: "F2" }),
	local("trees", "delete", DELETE),
	local("trees", "reorderUp", { ...UP, ...MOVE }),
	local("trees", "reorderDown", { ...DOWN, ...MOVE }),
	local("review", "markViewed", letter("V")),
	local("review", "nextUnreviewed", letter("J")),
	local("review", "nextFile", { ...DOWN, alt: true }),
	local("review", "previousFile", { ...UP, alt: true }),
	local("review", "nextStep", letter("N")),
	local("review", "previousStep", letter("P")),
	local("composer", "followUp", ...enter({ mod: true })),
	local("composer", "interrupt", ...enter({ mod: true, shift: true })),
	local("composer", "enterTranscript", { ...UP, mod: true }),
	local("transcript", "copy", letter("C")),
	local("transcript", "open", letter("O")),
	local("history", "send", ...enter({ mod: true })),
	local("history", "saveTemplate", letter("S", { mod: true })),
	local("history", "deleteChat", DELETE),
	local("palette", "startWork", ...enter({ mod: true })),
	local("palette", "ask", ...enter({ alt: true })),
	local("palette", "preview", letter("I", { mod: true })),
	local("findInFiles", "openKept", ...enter({ mod: true })),
	local("findInFiles", "matchCase", letter("C", { alt: true })),
	local("findInFiles", "wholeWord", letter("W", { alt: true })),
	local("settings.nav", "search", letter("S"), { code: "Slash", key: "/" }),
	local("settings", "reset", DELETE),
	local("settings.list", "remove", DELETE),
];

export const APP_LOCAL_SCOPES: readonly LocalScopeDeclaration[] = Object.entries(LOCAL_SCOPES).map(
	([id, info]) => ({
		id,
		...("includes" in info ? { includes: info.includes } : {}),
		...("extendsWithShift" in info ? { extendsWithShift: info.extendsWithShift } : {}),
	}),
);

function scopeDefaults(scope: AppLocalScope): readonly LocalKeyCommand[] {
	const info: LocalScopeInfo = LOCAL_SCOPES[scope];
	const scopes = [scope, ...(info.includes ?? [])];
	return scopes.flatMap((id) => APP_LOCAL_COMMANDS.filter((command) => command.scope === id));
}

export const LOCAL_KEY_DEFAULTS: Readonly<Record<AppLocalScope, readonly LocalKeyCommand[]>> = {
	[ARROW_TWINS_SCOPE]: scopeDefaults(ARROW_TWINS_SCOPE),
	[READING_SCOPE]: scopeDefaults(READING_SCOPE),
	tabs: scopeDefaults("tabs"),
	rails: scopeDefaults("rails"),
	trees: scopeDefaults("trees"),
	review: scopeDefaults("review"),
	"review.surface": scopeDefaults("review.surface"),
	transcript: scopeDefaults("transcript"),
	reader: scopeDefaults("reader"),
	composer: scopeDefaults("composer"),
	history: scopeDefaults("history"),
	palette: scopeDefaults("palette"),
	findInFiles: scopeDefaults("findInFiles"),
	"settings.nav": scopeDefaults("settings.nav"),
	settings: scopeDefaults("settings"),
	"settings.list": scopeDefaults("settings.list"),
};

export function isAppLocalScope(scope: string): scope is AppLocalScope {
	return Object.hasOwn(LOCAL_SCOPES, scope);
}
