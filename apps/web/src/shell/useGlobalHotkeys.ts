import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useEffect, useInsertionEffect, useRef } from "react";
import {
	runSuggestion,
	type SuggestionKeyAction,
	type SuggestionTarget,
	suggestionAt,
	suggestionKeyAction,
	suggestionTargetFor,
} from "../chat/suggestionTargets";
import {
	type KeybindingId,
	type KeyChord,
	matchKeybinding,
	matchLocal,
	pressesChord,
	type ResolvedKeybindings,
	type SuggestionKeybindingId,
} from "../keybindings";
import { isTextEntryTarget } from "../lib";
import { createDoubleShiftDetector } from "../search";
import { selectHistoryTarget, useAppStore } from "../store";
import { openChatHistory } from "./chordActions";
import { deliverExtensionCommand, extensionHotkey, keyboardClaimed } from "./extensionCommands";
import { currentKeybindings } from "./keybindingState";
import { matchShortcut, type ShortcutPlatform } from "./shortcutCommands";
import {
	hasLayer,
	isInCodeEditor,
	isInEditorFind,
	isInTerminal,
	MODAL_LAYER_SELECTOR,
} from "./shortcutLayers";
import { localScopesOf } from "./shortcutSurface";
import { nativeShortcutPlatform } from "./useAppShortcuts";

type ChordHandler = (binding: KeybindingId) => void;

type GlobalHotkeyActions = {
	onProjects: ChordHandler;
	onWorkspace?: ChordHandler;
	onBottom?: ChordHandler;
	onNewWorkspace?: ChordHandler;
	onSearch?: ChordHandler;
	onFindInFiles?: ChordHandler;
	onNextRegion?: ChordHandler;
	onPreviousRegion?: ChordHandler;
	onComposer?: ChordHandler;
	onFocusProjects?: ChordHandler;
	onFocusGroup?: ChordHandler;
	onTerminal?: ChordHandler;
	onFiles?: ChordHandler;
	onChanges?: ChordHandler;
	onCloseTab?: ChordHandler;
	onSplitRight?: ChordHandler;
	onMoveTab?: ChordHandler;
	onShortcuts?: ChordHandler;
};

const CHORD_ACTIONS = {
	"view.toggleLeft": "onProjects",
	"view.toggleRight": "onWorkspace",
	"view.toggleBottom": "onBottom",
	"view.files": "onFiles",
	"view.changes": "onChanges",
	"workspace.new": "onNewWorkspace",
	"search.open": "onSearch",
	"files.findInFiles": "onFindInFiles",
	"region.next": "onNextRegion",
	"region.previous": "onPreviousRegion",
	"focus.composer": "onComposer",
	"focus.projects": "onFocusProjects",
	"focus.terminal": "onTerminal",
	"focus.group1": "onFocusGroup",
	"focus.group2": "onFocusGroup",
	"focus.group3": "onFocusGroup",
	"focus.group4": "onFocusGroup",
	"focus.group5": "onFocusGroup",
	"focus.group6": "onFocusGroup",
	"focus.group7": "onFocusGroup",
	"focus.group8": "onFocusGroup",
	"focus.group9": "onFocusGroup",
	"tab.close": "onCloseTab",
	"group.splitRight": "onSplitRight",
	"tab.moveToPreviousGroup": "onMoveTab",
	"tab.moveToNextGroup": "onMoveTab",
	"shortcuts.open": "onShortcuts",
} as const satisfies Record<
	Exclude<KeybindingId, "chat.history" | SuggestionKeybindingId>,
	keyof GlobalHotkeyActions
>;

type GlobalHotkeyCommand = keyof typeof CHORD_ACTIONS;

type GlobalHotkeyEvent = Pick<
	KeyboardEvent,
	"altKey" | "code" | "ctrlKey" | "isComposing" | "key" | "metaKey" | "shiftKey"
> &
	Partial<Pick<KeyboardEvent, "getModifierState">>;

const CTRL_R: KeyChord = { code: "KeyR", key: "R", ctrl: true };

const TERMINAL_KEYS: readonly KeyChord[] = [
	{ code: "KeyL", key: "L", ctrl: true },
	{ code: "Backslash", key: "\\", ctrl: true },
	CTRL_R,
];

const EDITOR_FIND_KEYS: readonly KeyChord[] = [
	{ code: "KeyW", key: "W", mod: true, alt: true, platform: "apple" },
];

function isGlobalHotkeyCommand(id: string | null): id is GlobalHotkeyCommand {
	return id !== null && Object.hasOwn(CHORD_ACTIONS, id);
}

function elementKeeps(
	event: GlobalHotkeyEvent,
	platform: string,
	inTerminal: boolean,
	inEditorFind: boolean,
): boolean {
	return (
		(inTerminal && pressesChord(event, TERMINAL_KEYS, platform)) ||
		(inEditorFind && pressesChord(event, EDITOR_FIND_KEYS, platform))
	);
}

export function globalHotkeyCommand(
	event: GlobalHotkeyEvent,
	actions: GlobalHotkeyActions,
	modalOpen: boolean,
	keybindings: ResolvedKeybindings,
	inTerminal = false,
	inEditorFind = false,
): GlobalHotkeyCommand | null {
	if (event.isComposing || elementKeeps(event, keybindings.platform, inTerminal, inEditorFind)) {
		return null;
	}
	const id = matchKeybinding(keybindings, event);
	if (!isGlobalHotkeyCommand(id)) return null;
	if (modalOpen && id !== "tab.close") return null;
	return actions[CHORD_ACTIONS[id]] ? id : null;
}

interface HotkeyContext {
	readonly keybindings: ResolvedKeybindings;
	readonly desktop: ShortcutPlatform;
	readonly modalOpen: boolean;
	readonly textEntry: boolean;
	readonly localScopes: readonly string[];
	readonly inTerminal: boolean;
	readonly inEditorFind: boolean;
	readonly inCodeEditor: boolean;
	readonly hasSuggestion: (index: number) => boolean;
}

type HotkeyRoute =
	| { readonly kind: "extension"; readonly extension: string; readonly id: string }
	| { readonly kind: "command"; readonly id: GlobalHotkeyCommand }
	| ({ readonly kind: "suggestion" } & SuggestionKeyAction)
	| { readonly kind: "history" };

function suggestionHotkey(
	event: GlobalHotkeyEvent,
	context: HotkeyContext,
): SuggestionKeyAction | null {
	if (event.isComposing || context.modalOpen || context.inTerminal || context.inCodeEditor) {
		return null;
	}
	const action = suggestionKeyAction(matchKeybinding(context.keybindings, event));
	return action !== null && context.hasSuggestion(action.index) ? action : null;
}

export function routeHotkey(
	event: GlobalHotkeyEvent & Pick<KeyboardEvent, "keyCode">,
	actions: GlobalHotkeyActions,
	context: HotkeyContext,
): HotkeyRoute | null {
	const { keybindings, inTerminal, inEditorFind } = context;
	if (matchShortcut(event, context.desktop, () => inTerminal) !== null) return null;
	const { textEntry } = context;
	if (matchLocal(keybindings, context.localScopes, event, { textEntry }) !== null) return null;
	const extension = extensionHotkey(event, keybindings, textEntry);
	if (extension) return { kind: "extension", ...extension };
	const id = globalHotkeyCommand(
		event,
		actions,
		context.modalOpen,
		keybindings,
		inTerminal,
		inEditorFind,
	);
	if (id) return { kind: "command", id };
	const suggestion = suggestionHotkey(event, context);
	if (suggestion) return { kind: "suggestion", ...suggestion };
	if (matchKeybinding(keybindings, event) !== "chat.history") return null;
	if (elementKeeps(event, keybindings.platform, inTerminal, inEditorFind)) return null;
	if (isImeComposing(event) && !pressesChord(event, [CTRL_R], keybindings.platform)) return null;
	return { kind: "history" };
}

function chipsFor(target: EventTarget | null): () => SuggestionTarget | null {
	let resolved: SuggestionTarget | null | undefined;
	return () => {
		if (resolved === undefined) {
			resolved = suggestionTargetFor(
				target instanceof Node ? target : null,
				selectHistoryTarget(useAppStore.getState())?.sessionId ?? null,
			);
		}
		return resolved;
	};
}

function hasOpenModal(): boolean {
	return hasLayer(globalThis.document, MODAL_LAYER_SELECTOR);
}

const SEARCH_PALETTE_SELECTOR = '[data-testid="search-palette"]';

function hasModalOtherThanSearch(): boolean {
	for (const layer of globalThis.document.querySelectorAll(MODAL_LAYER_SELECTOR)) {
		if (!layer.closest(SEARCH_PALETTE_SELECTOR) && !layer.querySelector(SEARCH_PALETTE_SELECTOR)) {
			return true;
		}
	}
	return false;
}

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	useInsertionEffect(() => {
		actionsRef.current = actions;
	});

	useEffect(() => {
		const desktop = nativeShortcutPlatform();
		const onKeyDown = (event: KeyboardEvent) => {
			if (keyboardClaimed()) return;
			const target = event.composedPath()[0] ?? event.target;
			const current = actionsRef.current;
			const chips = chipsFor(event.target);
			const route = routeHotkey(event, current, {
				keybindings: currentKeybindings(),
				desktop,
				modalOpen: hasOpenModal(),
				textEntry: isTextEntryTarget(target),
				localScopes: localScopesOf(target instanceof Element ? target : null),
				inTerminal: isInTerminal(event.target),
				inEditorFind: isInEditorFind(event.target),
				inCodeEditor: isInCodeEditor(event.target),
				hasSuggestion: (index) => suggestionAt(chips(), index) !== undefined,
			});
			if (route === null) return;
			event.preventDefault();
			if (route.kind === "extension") {
				event.stopImmediatePropagation();
				if (!event.repeat) deliverExtensionCommand(route.extension, route.id);
				return;
			}
			event.stopPropagation();
			if (route.kind === "command") {
				if (!event.repeat) current[CHORD_ACTIONS[route.id]]?.(route.id);
			} else if (route.kind === "suggestion") {
				const owner = chips();
				if (!event.repeat && owner) runSuggestion(owner, route);
			} else if (!useAppStore.getState().searchOpen) openChatHistory();
		};
		const detector = createDoubleShiftDetector();
		const onDoubleShiftKeyDown = (event: KeyboardEvent) => {
			if (keyboardClaimed()) detector.reset();
			else detector.keydown(event);
		};
		const onDoubleShiftKeyUp = (event: KeyboardEvent) => {
			if (!detector.keyup(event) || keyboardClaimed()) return;
			const state = useAppStore.getState();
			if (!state.doubleShiftSearch || hasModalOtherThanSearch()) return;
			if (state.searchOpen) state.closeSearch();
			else state.openSearch();
		};
		const reset = () => detector.reset();
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keydown", onDoubleShiftKeyDown, true);
		window.addEventListener("keyup", onDoubleShiftKeyUp, true);
		window.addEventListener("pointerdown", reset, true);
		window.addEventListener("blur", reset);
		document.addEventListener("visibilitychange", reset);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keydown", onDoubleShiftKeyDown, true);
			window.removeEventListener("keyup", onDoubleShiftKeyUp, true);
			window.removeEventListener("pointerdown", reset, true);
			window.removeEventListener("blur", reset);
			document.removeEventListener("visibilitychange", reset);
		};
	}, []);
}
