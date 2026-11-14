import type { MessageKey } from "@thinkrail/locales";
import { type CommandShortcut, shortcutKeys } from "../commands";
import { platformFamily } from "../lib";
import {
	FOCUS_GROUP_BINDINGS,
	type KeybindingId,
	keybindingKeys,
	keybindingShortcut,
	keysLabel,
} from "./keybindings";

export const SHORTCUT_SURFACES = [
	"general",
	"tabs",
	"panels",
	"trees",
	"review",
	"composer",
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
	palette: "shortcuts.surface.palette",
	findInFiles: "shortcuts.surface.findInFiles",
	terminal: "shortcuts.surface.terminal",
	desktop: "shortcuts.surface.desktop",
} as const satisfies Record<ShortcutSurface, MessageKey>;

type ShortcutPlatform = "apple" | "other" | "linux";

export interface ShortcutKey extends CommandShortcut {
	readonly platform?: ShortcutPlatform;
}

export const TAB_KEYS = {
	close: { key: "Delete" },
	moveBefore: { key: "ArrowLeft", alt: true, shift: true },
	moveAfter: { key: "ArrowRight", alt: true, shift: true },
} as const satisfies Record<string, ShortcutKey>;

export const RAIL_KEYS = {
	remove: { key: "Delete" },
	moveUp: { key: "ArrowUp", alt: true, shift: true },
	moveDown: { key: "ArrowDown", alt: true, shift: true },
	moveLeft: { key: "ArrowLeft", alt: true, shift: true },
	moveRight: { key: "ArrowRight", alt: true, shift: true },
} as const satisfies Record<string, ShortcutKey>;

export const TREE_KEYS = {
	openKept: { key: "Enter", mod: true },
	rename: { key: "F2" },
	delete: { key: "Delete" },
	moveUp: { key: "ArrowUp", alt: true, shift: true },
	moveDown: { key: "ArrowDown", alt: true, shift: true },
} as const satisfies Record<string, ShortcutKey>;

export const REVIEW_KEYS = {
	markViewed: { key: "v" },
	nextUnreviewed: { key: "j" },
	nextFile: { key: "ArrowDown", alt: true },
	previousFile: { key: "ArrowUp", alt: true },
	nextStep: { key: "n" },
	previousStep: { key: "p" },
} as const satisfies Record<string, ShortcutKey>;

export const DESKTOP_KEYS = {
	settings: { key: ",", mod: true },
	zoomIn: { key: "=", mod: true },
	zoomOut: { key: "-", mod: true },
	zoomReset: { key: "Num 0", mod: true },
} as const satisfies Record<string, ShortcutKey>;

interface CatalogEntryBase {
	readonly id: string;
	readonly title: MessageKey;
	readonly surface: ShortcutSurface;
	readonly desktop?: true;
}

export type ShortcutCatalogEntry = CatalogEntryBase &
	(
		| { readonly bindings: readonly [KeybindingId, ...KeybindingId[]]; readonly keys?: never }
		| { readonly keys: readonly [ShortcutKey, ...ShortcutKey[]]; readonly bindings?: never }
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
	},
	{
		id: "dictation",
		title: "shortcuts.dictation",
		surface: "general",
		keys: [{ key: " ", mod: true, shift: true }],
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
	{ id: "tabs.select", title: "shortcuts.tabs.select", surface: "tabs", keys: [LEFT, RIGHT] },
	{ id: "tabs.firstLast", title: "shortcuts.tabs.firstLast", surface: "tabs", keys: [HOME, END] },
	{ id: "tabs.close", title: "shortcuts.tabs.close", surface: "tabs", keys: [TAB_KEYS.close] },
	{
		id: "tabs.reorder",
		title: "shortcuts.tabs.reorder",
		surface: "tabs",
		keys: [TAB_KEYS.moveBefore, TAB_KEYS.moveAfter],
	},
	{ id: "tabs.menu", title: "shortcuts.tabs.menu", surface: "tabs", keys: [MENU] },
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
	{
		id: "rail.move",
		title: "shortcuts.rail.move",
		surface: "panels",
		keys: [UP, DOWN, HOME, END],
	},
	{
		id: "rail.moveBottom",
		title: "shortcuts.rail.moveBottom",
		surface: "panels",
		keys: [LEFT, RIGHT, HOME, END],
	},
	{
		id: "rail.toggle",
		title: "shortcuts.rail.toggle",
		surface: "panels",
		keys: [ENTER, { key: " " }],
	},
	{
		id: "rail.remove",
		title: "shortcuts.rail.remove",
		surface: "panels",
		keys: [RAIL_KEYS.remove],
	},
	{
		id: "rail.reorder",
		title: "shortcuts.rail.reorder",
		surface: "panels",
		keys: [RAIL_KEYS.moveUp, RAIL_KEYS.moveDown],
	},
	{
		id: "rail.reorderBottom",
		title: "shortcuts.rail.reorderBottom",
		surface: "panels",
		keys: [RAIL_KEYS.moveLeft, RAIL_KEYS.moveRight],
	},
	{ id: "trees.move", title: "shortcuts.trees.move", surface: "trees", keys: [UP, DOWN] },
	{ id: "trees.expand", title: "shortcuts.trees.expand", surface: "trees", keys: [RIGHT, LEFT] },
	{
		id: "trees.firstLast",
		title: "shortcuts.trees.firstLast",
		surface: "trees",
		keys: [HOME, END],
	},
	{
		id: "trees.typeAhead",
		title: "shortcuts.trees.typeAhead",
		surface: "trees",
		keys: [{ key: "A–Z" }],
	},
	{ id: "trees.open", title: "shortcuts.trees.open", surface: "trees", keys: [ENTER] },
	{
		id: "trees.openKept",
		title: "shortcuts.trees.openKept",
		surface: "trees",
		keys: [TREE_KEYS.openKept],
	},
	{
		id: "trees.rename",
		title: "shortcuts.trees.rename",
		surface: "trees",
		keys: [TREE_KEYS.rename],
	},
	{
		id: "trees.delete",
		title: "shortcuts.trees.delete",
		surface: "trees",
		keys: [TREE_KEYS.delete],
	},
	{ id: "trees.menu", title: "shortcuts.trees.menu", surface: "trees", keys: [MENU] },
	{
		id: "trees.reorderProject",
		title: "shortcuts.trees.reorderProject",
		surface: "trees",
		keys: [TREE_KEYS.moveUp, TREE_KEYS.moveDown],
	},
	{
		id: "review.markViewed",
		title: "shortcuts.review.markViewed",
		surface: "review",
		keys: [REVIEW_KEYS.markViewed],
	},
	{
		id: "review.nextUnreviewed",
		title: "shortcuts.review.nextUnreviewed",
		surface: "review",
		keys: [REVIEW_KEYS.nextUnreviewed],
	},
	{
		id: "review.nextFile",
		title: "shortcuts.review.nextFile",
		surface: "review",
		keys: [REVIEW_KEYS.nextFile],
	},
	{
		id: "review.previousFile",
		title: "shortcuts.review.previousFile",
		surface: "review",
		keys: [REVIEW_KEYS.previousFile],
	},
	{
		id: "review.nextStep",
		title: "shortcuts.review.nextStep",
		surface: "review",
		keys: [REVIEW_KEYS.nextStep],
	},
	{
		id: "review.previousStep",
		title: "shortcuts.review.previousStep",
		surface: "review",
		keys: [REVIEW_KEYS.previousStep],
	},
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
		keys: [{ key: "Enter", mod: true }],
	},
	{
		id: "composer.interrupt",
		title: "shortcuts.composer.interrupt",
		surface: "composer",
		keys: [{ key: "Enter", mod: true, shift: true }],
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
		keys: [{ key: "Tab" }, { key: "Tab", shift: true }],
	},
	{ id: "palette.select", title: "shortcuts.palette.select", surface: "palette", keys: [UP, DOWN] },
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
		keys: [{ key: "Enter", mod: true }],
	},
	{
		id: "palette.ask",
		title: "shortcuts.palette.ask",
		surface: "palette",
		keys: [{ key: "Enter", alt: true }],
	},
	{
		id: "palette.preview",
		title: "shortcuts.palette.preview",
		surface: "palette",
		keys: [{ key: "I", mod: true }],
	},
	{ id: "palette.close", title: "shortcuts.palette.close", surface: "palette", keys: [ESCAPE] },
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
		keys: [{ key: "Enter", mod: true }],
	},
	{
		id: "findInFiles.matchCase",
		title: "shortcuts.findInFiles.matchCase",
		surface: "findInFiles",
		keys: [{ key: "C", alt: true }],
	},
	{
		id: "findInFiles.wholeWord",
		title: "shortcuts.findInFiles.wholeWord",
		surface: "findInFiles",
		keys: [{ key: "W", alt: true }],
	},
	{
		id: "findInFiles.close",
		title: "shortcuts.findInFiles.close",
		surface: "findInFiles",
		keys: [ESCAPE],
	},
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
	readonly platform?: string;
}

export interface ShortcutChordView {
	readonly keys: readonly string[];
	readonly label: string;
}

export interface ShortcutRow {
	readonly id: string;
	readonly title: MessageKey;
	readonly surface: ShortcutSurface;
	readonly chords: readonly ShortcutChordView[];
}

const KEY_LABELS: Readonly<Record<string, string>> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Enter: "↵",
	Escape: "Esc",
	" ": "Space",
};

function keyLabel(key: string, apple: boolean): string {
	if (key === "Shift") return apple ? "⇧" : "Shift";
	return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
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

function bindingCaps(
	bindings: readonly [KeybindingId, ...KeybindingId[]],
	{ desktop, platform }: ShortcutContext,
): string[] {
	const options = { browser: !desktop, ...(platform === undefined ? {} : { platform }) };
	const [first] = bindings;
	const last = bindings.at(-1) ?? first;
	if (last === first) return keybindingKeys(first, options);
	const from = keybindingShortcut(first, options);
	const to = keybindingShortcut(last, options);
	return shortcutKeys({ ...from, key: `${from.key}–${to.key}` }, platform);
}

function chordView(keys: readonly string[], platform?: string): ShortcutChordView {
	return { keys, label: keysLabel(keys, platform) };
}

export function shortcutRows(context: ShortcutContext): ShortcutRow[] {
	const { platform } = context;
	return SHORTCUT_CATALOG.flatMap((entry): ShortcutRow[] => {
		if (entry.desktop && !context.desktop) return [];
		const chords = entry.bindings
			? [chordView(bindingCaps(entry.bindings, context), platform)]
			: entry.keys
					.filter((chord) => onPlatform(chord.platform, platform))
					.map((chord) => chordView(shortcutKeyCaps(chord, platform), platform));
		if (chords.length === 0) return [];
		return [{ id: entry.id, title: entry.title, surface: entry.surface, chords }];
	});
}
