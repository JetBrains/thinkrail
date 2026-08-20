import { useEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";

const TERMINAL_ROOT_SELECTOR = ".xterm";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
};

function isInTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isPanelCommand =
				!event.altKey &&
				!event.shiftKey &&
				hasPlatformModifier(event) &&
				(event.code === "KeyB" || event.code === "KeyJ");
			if (isPanelCommand) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) {
					if (event.code === "KeyB") actionsRef.current.onProjects();
					else actionsRef.current.onWorkspace?.();
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
