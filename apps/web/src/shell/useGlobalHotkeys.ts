import { useEffect, useInsertionEffect, useRef } from "react";
import { type KeybindingId, matchKeybinding } from "../keybindings";
import { createDoubleShiftDetector } from "../search";
import { useAppStore } from "../store";
import { openChatHistory } from "./chordActions";
import { hasLayer, isInTerminal, MODAL_LAYER_SELECTOR } from "./shortcutLayers";

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
} as const satisfies Record<Exclude<KeybindingId, "chat.history">, keyof GlobalHotkeyActions>;

type GlobalHotkeyCommand = keyof typeof CHORD_ACTIONS;

type GlobalHotkeyEvent = Pick<
	KeyboardEvent,
	"altKey" | "code" | "ctrlKey" | "isComposing" | "metaKey" | "shiftKey"
>;

export function globalHotkeyCommand(
	event: GlobalHotkeyEvent,
	actions: GlobalHotkeyActions,
	modalOpen: boolean,
	platform?: string,
	inTerminal = false,
): GlobalHotkeyCommand | null {
	if (modalOpen || event.isComposing) return null;
	const id = matchKeybinding(event, platform);
	if (id === null || id === "chat.history") return null;
	if (id === "focus.composer" && inTerminal && event.ctrlKey) return null;
	return actions[CHORD_ACTIONS[id]] ? id : null;
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
		const onKeyDown = (event: KeyboardEvent) => {
			const current = actionsRef.current;
			const command = globalHotkeyCommand(
				event,
				current,
				hasOpenModal(),
				undefined,
				isInTerminal(event.target),
			);
			if (command) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) current[CHORD_ACTIONS[command]]?.(command);
				return;
			}

			if (matchKeybinding(event) !== "chat.history") return;
			if (isInTerminal(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			if (!useAppStore.getState().searchOpen) openChatHistory();
		};
		const detector = createDoubleShiftDetector();
		const onDoubleShiftKeyDown = (event: KeyboardEvent) => detector.keydown(event);
		const onDoubleShiftKeyUp = (event: KeyboardEvent) => {
			if (!detector.keyup(event)) return;
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
