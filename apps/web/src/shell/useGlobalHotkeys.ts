import { useEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";

const TERMINAL_ROOT_SELECTOR = ".xterm";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
	onBottom?: () => void;
};

type PanelHotkeyCommand = "projects" | "workspace" | "bottom";

type PanelHotkeyAvailability = Record<PanelHotkeyCommand, boolean>;

type PanelHotkeyEvent = Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey">;

export function panelHotkeyCommand(
	event: PanelHotkeyEvent,
	available: PanelHotkeyAvailability,
	modalOpen: boolean,
	platform?: string,
): PanelHotkeyCommand | null {
	if (modalOpen || event.altKey || !hasPlatformModifier(event, platform)) return null;
	if (!event.shiftKey && event.code === "KeyB" && available.projects) return "projects";
	if (!event.shiftKey && event.code === "KeyJ" && available.workspace) return "workspace";
	if (event.shiftKey && event.code === "KeyJ" && available.bottom) return "bottom";
	return null;
}

function hasOpenModal(): boolean {
	return (
		globalThis.document.querySelector('[aria-modal="true"], [role="dialog"][data-state="open"]') !==
		null
	);
}

function isInTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing) return;
			const command = panelHotkeyCommand(
				event,
				{
					projects: true,
					workspace: actionsRef.current.onWorkspace !== undefined,
					bottom: actionsRef.current.onBottom !== undefined,
				},
				hasOpenModal(),
			);
			if (command) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) {
					if (command === "projects") actionsRef.current.onProjects();
					else if (command === "workspace") actionsRef.current.onWorkspace?.();
					else actionsRef.current.onBottom?.();
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
