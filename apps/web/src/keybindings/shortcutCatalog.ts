import type { MessageKey } from "@thinkrail/locales";
import { keyCap } from "@thinkrail/ui/keyboard";
import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";
import { displayShortcut, FOCUS_GROUP_BINDINGS, type KeybindingId, keysLabel } from "./keybindings";
import {
	keybindingShortcut,
	keybindingShortcuts,
	lostHere,
	type ResolvedKeybindings,
} from "./resolve";

export const SHORTCUT_SURFACES = [
	"general",
	"tabs",
	"panels",
	"trees",
	"review",
	"composer",
	"transcript",
	"history",
	"palette",
	"findInFiles",
	"terminal",
	"desktop",
] as const;

export type ShortcutSurface = (typeof SHORTCUT_SURFACES)[number];

export const SHORTCUT_SURFACE_TITLES = {
	general: "shortcuts.surface.general",
	tabs: "shortcuts.surface.tabs",
	panels: "shortcuts.surface.panels",
	trees: "shortcuts.surface.trees",
	review: "shortcuts.surface.review",
	composer: "shortcuts.surface.composer",
	transcript: "shortcuts.surface.transcript",
	history: "shortcuts.surface.history",
	palette: "shortcuts.surface.palette",
	findInFiles: "shortcuts.surface.findInFiles",
	terminal: "shortcuts.surface.terminal",
	desktop: "shortcuts.surface.desktop",
} as const satisfies Record<ShortcutSurface, MessageKey>;

type ShortcutPlatform = "apple" | "other" | "linux";

export interface ShortcutKey extends CommandShortcut {
	readonly platform?: ShortcutPlatform;
}

export const DESKTOP_KEYS = {
	settings: { key: ",", mod: true },
	zoomIn: { key: "=", mod: true },
	zoomOut: { key: "-", mod: true },
	zoomReset: { key: "Num 0", mod: true },
} as const satisfies Record<string, ShortcutKey>;

export interface ShortcutTwin {
	readonly command: string;
	readonly shift?: true;
}

interface CatalogEntryBase {
	readonly id: string;
	readonly title: MessageKey;
	readonly surface: ShortcutSurface;
	readonly desktop?: true;
	readonly scope?: string;
}

export type ShortcutCatalogEntry = CatalogEntryBase &
	(
		| {
				readonly bindings: readonly [KeybindingId, ...KeybindingId[]];
				readonly bindingTitle?: MessageKey;
				readonly keys?: never;
				readonly local?: never;
				readonly twin?: never;
		  }
		| {
				readonly keys: readonly [ShortcutKey, ...ShortcutKey[]];
				readonly twin?: ShortcutTwin;
				readonly bindings?: never;
				readonly local?: never;
		  }
		| {
				readonly local: string;
				readonly keys?: readonly ShortcutKey[];
				readonly bindings?: never;
				readonly twin?: never;
		  }
	);

const UP = { key: "ArrowUp" } as const;
const DOWN = { key: "ArrowDown" } as const;
const LEFT = { key: "ArrowLeft" } as const;
const RIGHT = { key: "ArrowRight" } as const;
const HOME = { key: "Home" } as const;
const END = { key: "End" } as const;
const ENTER = { key: "Enter" } as const;
const ESCAPE = { key: "Escape" } as const;
const MENU = { key: "F10", shift: true } as const;
const PAGE_UP = { key: "PageUp" } as const;
const PAGE_DOWN = { key: "PageDown" } as const;
const TAB = { key: "Tab" } as const;

const TWIN = {
	left: { command: "arrows.left" },
	down: { command: "arrows.down" },
	up: { command: "arrows.up" },
	right: { command: "arrows.right" },
} as const satisfies Record<string, ShortcutTwin>;

const inScope = (scope: string, entries: readonly ShortcutCatalogEntry[]): ShortcutCatalogEntry[] =>
	entries.map((entry) => ({ ...entry, scope }));

export const SHORTCUT_CATALOG: readonly ShortcutCatalogEntry[] = [
	{
		id: "shortcuts.open",
		title: "shortcuts.open",
		surface: "general",
		bindings: ["shortcuts.open"],
	},
	{ id: "search.open", title: "shortcuts.search", surface: "general", bindings: ["search.open"] },
	{
		id: "search.doubleShift",
		title: "shortcuts.searchDoubleShift",
		surface: "general",
		keys: [{ key: "Shift", shift: true }],
	},
	{
		id: "files.findInFiles",
		title: "shortcuts.findInFiles",
		surface: "general",
		bindings: ["files.findInFiles"],
	},
	{
		id: "workspace.new",
		title: "shortcuts.newWorkspace",
		surface: "general",
		bindings: ["workspace.new"],
	},
	{
		id: "chat.history",
		title: "shortcuts.chatHistory",
		surface: "general",
		bindings: ["chat.history"],
	},
	{
		id: "region.next",
		title: "shortcuts.nextRegion",
		surface: "general",
		bindings: ["region.next"],
	},
	{
		id: "region.previous",
		title: "shortcuts.previousRegion",
		surface: "general",
		bindings: ["region.previous"],
	},
	{
		id: "focus.composer",
		title: "shortcuts.focusComposer",
		surface: "general",
		bindings: ["focus.composer"],
	},
	{
		id: "focus.projects",
		title: "shortcuts.focusProjects",
		surface: "general",
		bindings: ["focus.projects"],
	},
	{
		id: "focus.group",
		title: "shortcuts.focusGroup",
		surface: "general",
		bindings: FOCUS_GROUP_BINDINGS,
		bindingTitle: "commands.focus.group",
	},
	{
		id: "dictation",
		title: "shortcuts.dictation",
		surface: "general",
		keys: [{ key: " ", mod: true, shift: true }],
	},
	{ id: "arrows.left", title: "shortcuts.arrows.left", surface: "general", local: "arrows.left" },
	{ id: "arrows.down", title: "shortcuts.arrows.down", surface: "general", local: "arrows.down" },
	{ id: "arrows.up", title: "shortcuts.arrows.up", surface: "general", local: "arrows.up" },
	{
		id: "arrows.right",
		title: "shortcuts.arrows.right",
		surface: "general",
		local: "arrows.right",
	},
	{ id: "tab.close", title: "shortcuts.closeTab", surface: "tabs", bindings: ["tab.close"] },
	{
		id: "group.splitRight",
		title: "shortcuts.splitRight",
		surface: "tabs",
		bindings: ["group.splitRight"],
	},
	{
		id: "tab.moveToPreviousGroup",
		title: "shortcuts.moveToPreviousGroup",
		surface: "tabs",
		bindings: ["tab.moveToPreviousGroup"],
	},
	{
		id: "tab.moveToNextGroup",
		title: "shortcuts.moveToNextGroup",
		surface: "tabs",
		bindings: ["tab.moveToNextGroup"],
	},
	{
		id: "group.next",
		title: "shortcuts.nextGroup",
		surface: "tabs",
		keys: [{ key: "F6", ctrl: true }],
	},
	{
		id: "group.previous",
		title: "shortcuts.previousGroup",
		surface: "tabs",
		keys: [{ key: "F6", ctrl: true, shift: true }],
	},
	...inScope("tabs", [
		{
			id: "tabs.previous",
			title: "shortcuts.tabs.previous",
			surface: "tabs",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "tabs.next",
			title: "shortcuts.tabs.next",
			surface: "tabs",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{ id: "tabs.firstLast", title: "shortcuts.tabs.firstLast", surface: "tabs", keys: [HOME, END] },
		{ id: "tabs.close", title: "shortcuts.tabs.close", surface: "tabs", local: "tabs.close" },
		{
			id: "tabs.moveBefore",
			title: "shortcuts.tabs.moveBefore",
			surface: "tabs",
			local: "tabs.moveBefore",
		},
		{
			id: "tabs.moveAfter",
			title: "shortcuts.tabs.moveAfter",
			surface: "tabs",
			local: "tabs.moveAfter",
		},
		{ id: "tabs.menu", title: "shortcuts.tabs.menu", surface: "tabs", keys: [MENU] },
	]),
	{
		id: "view.toggleLeft",
		title: "shortcuts.toggleLeft",
		surface: "panels",
		bindings: ["view.toggleLeft"],
	},
	{
		id: "view.toggleRight",
		title: "shortcuts.toggleRight",
		surface: "panels",
		bindings: ["view.toggleRight"],
	},
	{
		id: "view.toggleBottom",
		title: "shortcuts.toggleBottom",
		surface: "panels",
		bindings: ["view.toggleBottom"],
	},
	{ id: "view.files", title: "shortcuts.showFiles", surface: "panels", bindings: ["view.files"] },
	{
		id: "view.changes",
		title: "shortcuts.showChanges",
		surface: "panels",
		bindings: ["view.changes"],
	},
	...inScope("rails", [
		{ id: "rails.up", title: "shortcuts.rail.up", surface: "panels", keys: [UP], twin: TWIN.up },
		{
			id: "rails.down",
			title: "shortcuts.rail.down",
			surface: "panels",
			keys: [DOWN],
			twin: TWIN.down,
		},
		{
			id: "rails.left",
			title: "shortcuts.rail.left",
			surface: "panels",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "rails.right",
			title: "shortcuts.rail.right",
			surface: "panels",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "rails.firstLast",
			title: "shortcuts.rail.firstLast",
			surface: "panels",
			keys: [HOME, END],
		},
		{
			id: "rail.toggle",
			title: "shortcuts.rail.toggle",
			surface: "panels",
			keys: [ENTER, { key: " " }],
		},
		{
			id: "rails.remove",
			title: "shortcuts.rail.remove",
			surface: "panels",
			local: "rails.remove",
		},
		{
			id: "rails.moveUp",
			title: "shortcuts.rail.moveUp",
			surface: "panels",
			local: "rails.moveUp",
		},
		{
			id: "rails.moveDown",
			title: "shortcuts.rail.moveDown",
			surface: "panels",
			local: "rails.moveDown",
		},
		{
			id: "rails.moveLeft",
			title: "shortcuts.rail.moveLeft",
			surface: "panels",
			local: "rails.moveLeft",
		},
		{
			id: "rails.moveRight",
			title: "shortcuts.rail.moveRight",
			surface: "panels",
			local: "rails.moveRight",
		},
	]),
	...inScope("trees", [
		{ id: "trees.up", title: "shortcuts.trees.up", surface: "trees", keys: [UP], twin: TWIN.up },
		{
			id: "trees.down",
			title: "shortcuts.trees.down",
			surface: "trees",
			keys: [DOWN],
			twin: TWIN.down,
		},
		{
			id: "trees.expand",
			title: "shortcuts.trees.expand",
			surface: "trees",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "trees.collapse",
			title: "shortcuts.trees.collapse",
			surface: "trees",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "trees.search",
			title: "shortcuts.trees.search",
			surface: "trees",
			local: "trees.search",
		},
		{
			id: "trees.openKept",
			title: "shortcuts.trees.openKept",
			surface: "trees",
			local: "trees.openKept",
		},
		{
			id: "trees.rename",
			title: "shortcuts.trees.rename",
			surface: "trees",
			local: "trees.rename",
		},
		{
			id: "trees.delete",
			title: "shortcuts.trees.delete",
			surface: "trees",
			local: "trees.delete",
		},
		{
			id: "trees.reorderUp",
			title: "shortcuts.trees.reorderUp",
			surface: "trees",
			local: "trees.reorderUp",
		},
		{
			id: "trees.reorderDown",
			title: "shortcuts.trees.reorderDown",
			surface: "trees",
			local: "trees.reorderDown",
		},
		{
			id: "trees.firstLast",
			title: "shortcuts.trees.firstLast",
			surface: "trees",
			keys: [HOME, END],
		},
		{
			id: "trees.searchStep",
			title: "shortcuts.trees.searchStep",
			surface: "trees",
			keys: [DOWN, UP],
		},
		{
			id: "trees.searchKeep",
			title: "shortcuts.trees.searchKeep",
			surface: "trees",
			keys: [ENTER],
		},
		{
			id: "trees.searchCancel",
			title: "shortcuts.trees.searchCancel",
			surface: "trees",
			keys: [ESCAPE],
		},
		{ id: "trees.open", title: "shortcuts.trees.open", surface: "trees", keys: [ENTER] },
		{ id: "trees.menu", title: "shortcuts.trees.menu", surface: "trees", keys: [MENU] },
	]),
	{
		id: "review.markViewed",
		title: "shortcuts.review.markViewed",
		surface: "review",
		local: "review.markViewed",
	},
	{
		id: "review.nextUnreviewed",
		title: "shortcuts.review.nextUnreviewed",
		surface: "review",
		local: "review.nextUnreviewed",
	},
	{
		id: "review.nextFile",
		title: "shortcuts.review.nextFile",
		surface: "review",
		local: "review.nextFile",
	},
	{
		id: "review.previousFile",
		title: "shortcuts.review.previousFile",
		surface: "review",
		local: "review.previousFile",
	},
	{
		id: "review.nextStep",
		title: "shortcuts.review.nextStep",
		surface: "review",
		local: "review.nextStep",
	},
	{
		id: "review.previousStep",
		title: "shortcuts.review.previousStep",
		surface: "review",
		local: "review.previousStep",
	},
	...inScope("review.surface", [
		{
			id: "review.cursorUp",
			title: "shortcuts.review.cursorUp",
			surface: "review",
			keys: [UP],
			twin: TWIN.up,
		},
		{
			id: "review.cursorDown",
			title: "shortcuts.review.cursorDown",
			surface: "review",
			keys: [DOWN],
			twin: TWIN.down,
		},
		{
			id: "review.cursorLeft",
			title: "shortcuts.review.cursorLeft",
			surface: "review",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "review.cursorRight",
			title: "shortcuts.review.cursorRight",
			surface: "review",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "review.cursorFirstLast",
			title: "shortcuts.review.cursorFirstLast",
			surface: "review",
			keys: [HOME, END],
		},
		{
			id: "review.extendUp",
			title: "shortcuts.review.extendUp",
			surface: "review",
			keys: [{ ...UP, shift: true }],
			twin: { ...TWIN.up, shift: true },
		},
		{
			id: "review.extendDown",
			title: "shortcuts.review.extendDown",
			surface: "review",
			keys: [{ ...DOWN, shift: true }],
			twin: { ...TWIN.down, shift: true },
		},
		{
			id: "review.comment",
			title: "shortcuts.review.comment",
			surface: "review",
			local: "review.surface.comment",
			keys: [ENTER],
		},
		{
			id: "review.cursorClear",
			title: "shortcuts.review.cursorClear",
			surface: "review",
			keys: [ESCAPE],
		},
		{
			id: "review.nextComment",
			title: "shortcuts.review.nextComment",
			surface: "review",
			keys: [TAB],
		},
		{
			id: "review.saveDraft",
			title: "shortcuts.review.saveDraft",
			surface: "review",
			local: "review.surface.saveDraft",
		},
		{
			id: "review.sendNow",
			title: "shortcuts.review.sendNow",
			surface: "review",
			local: "review.surface.sendNow",
		},
		{
			id: "review.cancelComment",
			title: "shortcuts.review.cancelComment",
			surface: "review",
			keys: [ESCAPE],
		},
		{
			id: "review.regionFrame",
			title: "shortcuts.review.regionFrame",
			surface: "review",
			keys: [ENTER],
		},
		{
			id: "review.regionLeft",
			title: "shortcuts.review.regionLeft",
			surface: "review",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "review.regionRight",
			title: "shortcuts.review.regionRight",
			surface: "review",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "review.regionUp",
			title: "shortcuts.review.regionUp",
			surface: "review",
			keys: [UP],
			twin: TWIN.up,
		},
		{
			id: "review.regionDown",
			title: "shortcuts.review.regionDown",
			surface: "review",
			keys: [DOWN],
			twin: TWIN.down,
		},
		{
			id: "review.regionResize",
			title: "shortcuts.review.regionResize",
			surface: "review",
			keys: [
				{ ...LEFT, shift: true },
				{ ...RIGHT, shift: true },
				{ ...UP, shift: true },
				{ ...DOWN, shift: true },
			],
		},
		{
			id: "review.swipeLeft",
			title: "shortcuts.review.swipeLeft",
			surface: "review",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "review.swipeRight",
			title: "shortcuts.review.swipeRight",
			surface: "review",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "review.swipeFar",
			title: "shortcuts.review.swipeFar",
			surface: "review",
			keys: [{ ...LEFT, shift: true }, { ...RIGHT, shift: true }, PAGE_UP, PAGE_DOWN, HOME, END],
		},
	]),
	...inScope("composer", [
		{ id: "composer.send", title: "shortcuts.composer.send", surface: "composer", keys: [ENTER] },
		{
			id: "composer.newLine",
			title: "shortcuts.composer.newLine",
			surface: "composer",
			keys: [{ key: "Enter", shift: true }],
		},
		{
			id: "composer.followUp",
			title: "shortcuts.composer.followUp",
			surface: "composer",
			local: "composer.followUp",
		},
		{
			id: "composer.interrupt",
			title: "shortcuts.composer.interrupt",
			surface: "composer",
			local: "composer.interrupt",
		},
		{
			id: "composer.recall",
			title: "shortcuts.composer.recall",
			surface: "composer",
			keys: [UP, DOWN],
		},
		{
			id: "composer.slots",
			title: "shortcuts.composer.slots",
			surface: "composer",
			keys: [TAB, { key: "Tab", shift: true }],
		},
		{
			id: "composer.enterTranscript",
			title: "shortcuts.composer.enterTranscript",
			surface: "composer",
			local: "composer.enterTranscript",
		},
		{
			id: "composer.scrollTranscript",
			title: "shortcuts.composer.scrollTranscript",
			surface: "composer",
			keys: [PAGE_UP, PAGE_DOWN],
		},
	]),
	...inScope("transcript", [
		{
			id: "transcript.up",
			title: "shortcuts.transcript.up",
			surface: "transcript",
			keys: [UP],
			twin: TWIN.up,
		},
		{
			id: "transcript.down",
			title: "shortcuts.transcript.down",
			surface: "transcript",
			keys: [DOWN],
			twin: TWIN.down,
		},
		{
			id: "transcript.expand",
			title: "shortcuts.transcript.expand",
			surface: "transcript",
			keys: [RIGHT],
			twin: TWIN.right,
		},
		{
			id: "transcript.collapse",
			title: "shortcuts.transcript.collapse",
			surface: "transcript",
			keys: [LEFT],
			twin: TWIN.left,
		},
		{
			id: "transcript.copy",
			title: "shortcuts.transcript.copy",
			surface: "transcript",
			local: "transcript.copy",
		},
		{
			id: "transcript.open",
			title: "shortcuts.transcript.open",
			surface: "transcript",
			local: "transcript.open",
		},
		{
			id: "transcript.firstLast",
			title: "shortcuts.transcript.firstLast",
			surface: "transcript",
			keys: [HOME, END],
		},
		{
			id: "transcript.page",
			title: "shortcuts.transcript.page",
			surface: "transcript",
			keys: [PAGE_UP, PAGE_DOWN],
		},
		{
			id: "transcript.toggle",
			title: "shortcuts.transcript.toggle",
			surface: "transcript",
			keys: [ENTER],
		},
		{
			id: "transcript.menu",
			title: "shortcuts.transcript.menu",
			surface: "transcript",
			keys: [MENU],
		},
		{
			id: "transcript.controls",
			title: "shortcuts.transcript.controls",
			surface: "transcript",
			keys: [TAB],
		},
		{
			id: "transcript.back",
			title: "shortcuts.transcript.back",
			surface: "transcript",
			keys: [ESCAPE],
		},
	]),
	...inScope("history", [
		{
			id: "history.select",
			title: "shortcuts.history.select",
			surface: "history",
			keys: [UP, DOWN],
		},
		{ id: "history.insert", title: "shortcuts.history.insert", surface: "history", keys: [ENTER] },
		{
			id: "history.send",
			title: "shortcuts.history.send",
			surface: "history",
			local: "history.send",
		},
		{
			id: "history.jump",
			title: "shortcuts.history.jump",
			surface: "history",
			keys: [{ key: "Enter", shift: true }],
		},
		{
			id: "history.saveTemplate",
			title: "shortcuts.history.saveTemplate",
			surface: "history",
			local: "history.saveTemplate",
		},
		{ id: "history.preview", title: "shortcuts.history.preview", surface: "history", keys: [TAB] },
		{
			id: "history.deleteChat",
			title: "shortcuts.history.deleteChat",
			surface: "history",
			local: "history.deleteChat",
		},
		{ id: "history.menu", title: "shortcuts.history.menu", surface: "history", keys: [MENU] },
		{ id: "history.close", title: "shortcuts.history.close", surface: "history", keys: [ESCAPE] },
	]),
	...inScope("palette", [
		{
			id: "palette.select",
			title: "shortcuts.palette.select",
			surface: "palette",
			keys: [UP, DOWN],
		},
		{ id: "palette.open", title: "shortcuts.palette.open", surface: "palette", keys: [ENTER] },
		{
			id: "palette.scope",
			title: "shortcuts.palette.scope",
			surface: "palette",
			keys: [
				{ key: "Tab" },
				{ key: "Tab", shift: true },
				{ key: "1–9", alt: true, platform: "other" },
			],
		},
		{
			id: "palette.startWork",
			title: "shortcuts.palette.startWork",
			surface: "palette",
			local: "palette.startWork",
		},
		{ id: "palette.ask", title: "shortcuts.palette.ask", surface: "palette", local: "palette.ask" },
		{
			id: "palette.preview",
			title: "shortcuts.palette.preview",
			surface: "palette",
			local: "palette.preview",
		},
		{ id: "palette.close", title: "shortcuts.palette.close", surface: "palette", keys: [ESCAPE] },
	]),
	...inScope("findInFiles", [
		{
			id: "findInFiles.select",
			title: "shortcuts.findInFiles.select",
			surface: "findInFiles",
			keys: [UP, DOWN],
		},
		{
			id: "findInFiles.open",
			title: "shortcuts.findInFiles.open",
			surface: "findInFiles",
			keys: [ENTER],
		},
		{
			id: "findInFiles.openKept",
			title: "shortcuts.findInFiles.openKept",
			surface: "findInFiles",
			local: "findInFiles.openKept",
		},
		{
			id: "findInFiles.matchCase",
			title: "shortcuts.findInFiles.matchCase",
			surface: "findInFiles",
			local: "findInFiles.matchCase",
		},
		{
			id: "findInFiles.wholeWord",
			title: "shortcuts.findInFiles.wholeWord",
			surface: "findInFiles",
			local: "findInFiles.wholeWord",
		},
		{
			id: "findInFiles.close",
			title: "shortcuts.findInFiles.close",
			surface: "findInFiles",
			keys: [ESCAPE],
		},
	]),
	{
		id: "focus.terminal",
		title: "shortcuts.focusTerminal",
		surface: "terminal",
		bindings: ["focus.terminal"],
	},
	{
		id: "terminal.copy",
		title: "shortcuts.terminal.copy",
		surface: "terminal",
		keys: [{ key: "C", ctrl: true, shift: true, platform: "other" }],
	},
	{
		id: "desktop.settings",
		title: "shortcuts.desktop.settings",
		surface: "desktop",
		desktop: true,
		keys: [DESKTOP_KEYS.settings],
	},
	{
		id: "desktop.closeItem",
		title: "shortcuts.desktop.closeItem",
		surface: "desktop",
		desktop: true,
		keys: [{ key: "F4", ctrl: true, platform: "other" }],
	},
	{
		id: "desktop.quit",
		title: "shortcuts.desktop.quit",
		surface: "desktop",
		desktop: true,
		keys: [
			{ key: "Q", mod: true, platform: "apple" },
			{ key: "Q", mod: true, platform: "linux" },
		],
	},
	{
		id: "desktop.zoomIn",
		title: "shortcuts.desktop.zoomIn",
		surface: "desktop",
		desktop: true,
		keys: [DESKTOP_KEYS.zoomIn],
	},
	{
		id: "desktop.zoomOut",
		title: "shortcuts.desktop.zoomOut",
		surface: "desktop",
		desktop: true,
		keys: [DESKTOP_KEYS.zoomOut],
	},
	{
		id: "desktop.zoomReset",
		title: "shortcuts.desktop.zoomReset",
		surface: "desktop",
		desktop: true,
		keys: [DESKTOP_KEYS.zoomReset],
	},
	{
		id: "desktop.minimize",
		title: "shortcuts.desktop.minimize",
		surface: "desktop",
		desktop: true,
		keys: [{ key: "M", mod: true, platform: "apple" }],
	},
	{
		id: "desktop.hide",
		title: "shortcuts.desktop.hide",
		surface: "desktop",
		desktop: true,
		keys: [{ key: "H", mod: true, platform: "apple" }],
	},
	{
		id: "desktop.hideOthers",
		title: "shortcuts.desktop.hideOthers",
		surface: "desktop",
		desktop: true,
		keys: [{ key: "H", mod: true, alt: true, platform: "apple" }],
	},
];

export interface ShortcutContext {
	readonly desktop: boolean;
	readonly keybindings: ResolvedKeybindings;
	readonly extra?: readonly ShortcutCatalogEntry[];
}

export interface ShortcutChordView {
	readonly keys: readonly string[];
	readonly label: string;
}

export interface ShortcutConflictView extends ShortcutChordView {
	readonly winner: string;
}

export interface ShortcutRow {
	readonly id: string;
	readonly title: MessageKey;
	readonly surface: ShortcutSurface;
	readonly chords: readonly ShortcutChordView[];
	readonly conflicts: readonly ShortcutConflictView[];
}

function keyLabel(key: string, apple: boolean): string {
	if (key === "Shift") return apple ? "⇧" : "Shift";
	return keyCap(key);
}

export function shortcutKeyCaps(chord: ShortcutKey, platform?: string): string[] {
	const { platform: _scope, ...shortcut } = chord;
	return shortcutKeys(
		{ ...shortcut, key: keyLabel(chord.key, platformFamily(platform) === "apple") },
		platform,
	);
}

function onPlatform(scope: ShortcutPlatform | undefined, platform?: string): boolean {
	const family = platformFamily(platform);
	if (scope === undefined) return true;
	if (scope === "apple") return family === "apple";
	if (scope === "linux") return family === "linux";
	return family !== "apple";
}

function capsView(keys: readonly string[], platform: string): ShortcutChordView {
	return { keys, label: keysLabel(keys, platform) };
}

function chordView(shortcut: CommandShortcut, platform: string): ShortcutChordView {
	return capsView(shortcutKeys(shortcut, platform), platform);
}

function atDefault(keybindings: ResolvedKeybindings, id: string): boolean {
	const command = keybindings.byId.get(id);
	return command !== undefined && !command.custom && command.chords.every((c) => !c.lostTo);
}

function conflictViews(
	keybindings: ResolvedKeybindings,
	ids: readonly string[],
): ShortcutConflictView[] {
	return ids.flatMap((id) =>
		(keybindings.byId.get(id)?.chords ?? []).flatMap(({ chord, lostTo }) =>
			lostTo === null
				? []
				: [{ ...chordView(displayShortcut(chord), keybindings.platform), winner: lostTo }],
		),
	);
}

function bindingChords(
	bindings: readonly [KeybindingId, ...KeybindingId[]],
	{ desktop, keybindings }: ShortcutContext,
): ShortcutChordView[] {
	const options = { browser: !desktop };
	const { platform } = keybindings;
	const [first] = bindings;
	const last = bindings.at(-1) ?? first;
	const from = keybindingShortcut(keybindings, first, options);
	const to = keybindingShortcut(keybindings, last, options);
	if (last !== first && from && to && bindings.every((id) => atDefault(keybindings, id))) {
		return [chordView({ ...from, key: `${from.key}–${to.key}` }, platform)];
	}
	return bindings.flatMap((id) => {
		const shortcut = keybindingShortcut(keybindings, id, options);
		return shortcut ? [chordView(shortcut, platform)] : [];
	});
}

function row(
	entry: Pick<ShortcutRow, "id" | "title" | "surface">,
	chords: readonly ShortcutChordView[],
	conflicts: readonly ShortcutConflictView[],
): ShortcutRow[] {
	if (chords.length === 0 && conflicts.length === 0) return [];
	return [{ id: entry.id, title: entry.title, surface: entry.surface, chords, conflicts }];
}

export function keyChords(keys: readonly ShortcutKey[], platform: string): ShortcutChordView[] {
	return keys
		.filter((chord) => onPlatform(chord.platform, platform))
		.map((chord) => capsView(shortcutKeyCaps(chord, platform), platform));
}

function scopedViews(
	keybindings: ResolvedKeybindings,
	id: string,
	scope: string | null,
	shift = false,
): { chords: ShortcutChordView[]; conflicts: ShortcutConflictView[] } {
	const chords: ShortcutChordView[] = [];
	const conflicts: ShortcutConflictView[] = [];
	for (const resolved of keybindings.byId.get(id)?.chords ?? []) {
		const view = chordView(
			{ ...displayShortcut(resolved.chord), ...(shift ? { shift: true } : {}) },
			keybindings.platform,
		);
		const winner = lostHere(resolved, scope);
		if (winner === null) chords.push(view);
		else conflicts.push({ ...view, winner });
	}
	return { chords, conflicts };
}

export function entryScope(
	entry: ShortcutCatalogEntry,
	keybindings: ResolvedKeybindings,
): string | null {
	if (entry.local !== undefined) return keybindings.byId.get(entry.local)?.scope ?? null;
	return entry.scope ?? null;
}

function entryRows(entry: ShortcutCatalogEntry, context: ShortcutContext): ShortcutRow[] {
	const { keybindings } = context;
	const { platform } = keybindings;
	if (entry.desktop && !context.desktop) return [];
	if (entry.local !== undefined) {
		const views = scopedViews(keybindings, entry.local, entryScope(entry, keybindings));
		return row(entry, [...keyChords(entry.keys ?? [], platform), ...views.chords], views.conflicts);
	}
	if (entry.keys) {
		const fixed = keyChords(entry.keys, platform);
		if (entry.twin === undefined) return row(entry, fixed, []);
		const { command, shift = false } = entry.twin;
		const views = scopedViews(keybindings, command, entry.scope ?? null, shift);
		return row(entry, [...fixed, ...views.chords], views.conflicts);
	}
	return row(
		entry,
		bindingChords(entry.bindings, context),
		conflictViews(keybindings, entry.bindings),
	);
}

function extensionCommandRows({ desktop, keybindings }: ShortcutContext): ShortcutRow[] {
	return keybindings.commands.flatMap(({ id, extension, enabled, title }) =>
		extension !== null && enabled && title !== null
			? row(
					{ id, title, surface: "general" },
					keybindingShortcuts(keybindings, id, { browser: !desktop }).map((shortcut) =>
						chordView(shortcut, keybindings.platform),
					),
					conflictViews(keybindings, [id]),
				)
			: [],
	);
}

export function shortcutRows(context: ShortcutContext): ShortcutRow[] {
	const { extra = [] } = context;
	return [
		...SHORTCUT_CATALOG.flatMap((entry) => entryRows(entry, context)),
		...extensionCommandRows(context),
		...extra.flatMap((entry) => entryRows(entry, context)),
	];
}

export type TypedPress = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

const typedKey = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

export function elementKeyUses(press: TypedPress, platform: string): ShortcutCatalogEntry[] {
	if (press.ctrlKey || press.metaKey || press.altKey) return [];
	const pressed = typedKey(press.key);
	return SHORTCUT_CATALOG.filter(({ keys = [] }) =>
		keys.some(
			(key) =>
				onPlatform(key.platform, platform) &&
				!key.mod &&
				!key.ctrl &&
				!key.alt &&
				(key.shift === true) === press.shiftKey &&
				typedKey(key.key) === pressed,
		),
	);
}
