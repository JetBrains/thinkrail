import { useEffect, useInsertionEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";
import { hasLayer, isInTerminal, MODAL_LAYER_SELECTOR } from "./shortcutLayers";
import { openSettingsUnlessLayered, settingsShortcutOwner } from "./useAppShortcuts";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
	onBottom?: () => void;
	onNewWorkspace?: () => void;
};

type GlobalHotkeyCommand = "projects" | "workspace" | "bottom" | "new-workspace" | "settings";

type GlobalHotkeyAvailability = {
	projects: boolean;
	workspace: boolean;
	bottom: boolean;
	newWorkspace: boolean;
	settings: boolean;
};

type GlobalHotkeyEvent = Pick<
	KeyboardEvent,
	"altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const PRINTABLE_ASCII = /^[\x20-\x7e]$/;

const isSettingsChord = (event: GlobalHotkeyEvent) =>
	event.metaKey &&
	!event.ctrlKey &&
	!event.altKey &&
	!event.shiftKey &&
	(PRINTABLE_ASCII.test(event.key) ? event.key === "," : event.code === "Comma");

export function globalHotkeyCommand(
	event: GlobalHotkeyEvent,
	available: GlobalHotkeyAvailability,
	modalOpen: boolean,
	platform?: string,
): GlobalHotkeyCommand | null {
	if (available.settings && isSettingsChord(event)) return "settings";
	if (modalOpen || !hasPlatformModifier(event, platform)) return null;
	if (!event.shiftKey && event.code === "KeyN" && available.newWorkspace) return "new-workspace";
	if (event.altKey) return null;
	if (!event.shiftKey && event.code === "KeyB" && available.projects) return "projects";
	if (!event.shiftKey && event.code === "KeyJ" && available.workspace) return "workspace";
	if (event.shiftKey && event.code === "KeyJ" && available.bottom) return "bottom";
	return null;
}

function hasOpenModal(): boolean {
	return hasLayer(globalThis.document, MODAL_LAYER_SELECTOR);
}

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	useInsertionEffect(() => {
		actionsRef.current = actions;
	});

	useEffect(() => {
		const settings = settingsShortcutOwner() === "web";
		const onKeyDown = (event: KeyboardEvent) => {
			const command = globalHotkeyCommand(
				event,
				{
					settings,
					projects: true,
					workspace: actionsRef.current.onWorkspace !== undefined,
					bottom: actionsRef.current.onBottom !== undefined,
					newWorkspace: actionsRef.current.onNewWorkspace !== undefined,
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
					else if (command === "settings") openSettingsUnlessLayered();
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
			const target = selectHistoryTarget(useAppStore.getState());
			if (target) useAppStore.getState().requestHistoryOpen(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
