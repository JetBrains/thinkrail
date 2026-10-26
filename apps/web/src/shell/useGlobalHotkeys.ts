import { useEffect, useInsertionEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { createDoubleShiftDetector } from "../search";
import { selectHistoryTarget, useAppStore } from "../store";
import { hasLayer, isInTerminal, MODAL_LAYER_SELECTOR } from "./shortcutLayers";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
	onBottom?: () => void;
	onNewWorkspace?: () => void;
	onSearch?: () => void;
	onFindInFiles?: () => void;
};

type GlobalHotkeyCommand =
	| "projects"
	| "workspace"
	| "bottom"
	| "new-workspace"
	| "search"
	| "find-in-files";

type GlobalHotkeyAvailability = {
	projects: boolean;
	workspace: boolean;
	bottom: boolean;
	newWorkspace: boolean;
	search: boolean;
	findInFiles?: boolean;
};

type GlobalHotkeyEvent = Pick<
	KeyboardEvent,
	"altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export function globalHotkeyCommand(
	event: GlobalHotkeyEvent,
	available: GlobalHotkeyAvailability,
	modalOpen: boolean,
	platform?: string,
): GlobalHotkeyCommand | null {
	if (modalOpen || !hasPlatformModifier(event, platform)) return null;
	if (!event.shiftKey && event.code === "KeyN" && available.newWorkspace) return "new-workspace";
	if (!event.shiftKey && !event.altKey && event.code === "KeyK" && available.search)
		return "search";
	if (event.altKey) return null;
	if (event.shiftKey && event.code === "KeyF" && available.findInFiles) return "find-in-files";
	if (!event.shiftKey && event.code === "KeyB" && available.projects) return "projects";
	if (!event.shiftKey && event.code === "KeyJ" && available.workspace) return "workspace";
	if (event.shiftKey && event.code === "KeyJ" && available.bottom) return "bottom";
	return null;
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
			const command = globalHotkeyCommand(
				event,
				{
					projects: true,
					workspace: actionsRef.current.onWorkspace !== undefined,
					bottom: actionsRef.current.onBottom !== undefined,
					newWorkspace: actionsRef.current.onNewWorkspace !== undefined,
					search: actionsRef.current.onSearch !== undefined,
					findInFiles: actionsRef.current.onFindInFiles !== undefined,
				},
				hasOpenModal(),
			);
			if (command) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) {
					if (command === "projects") actionsRef.current.onProjects();
					else if (command === "workspace") actionsRef.current.onWorkspace?.();
					else if (command === "bottom") actionsRef.current.onBottom?.();
					else if (command === "search") actionsRef.current.onSearch?.();
					else if (command === "find-in-files") actionsRef.current.onFindInFiles?.();
					else actionsRef.current.onNewWorkspace?.();
				}
				return;
			}

			if (
				event.code !== "KeyR" ||
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}
			if (isInTerminal(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			const state = useAppStore.getState();
			if (state.searchOpen) return;
			const target = selectHistoryTarget(state);
			if (target) state.requestHistoryOpen(target);
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
