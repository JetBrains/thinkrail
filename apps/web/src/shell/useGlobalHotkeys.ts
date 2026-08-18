import { useEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";

const TERMINAL_ROOT_SELECTOR = ".xterm";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onWorkspace?: () => void;
};

/** Everything xterm renders, including its input textarea, lives under this library-owned root. */
function isInTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

/**
 * The shell's one capture-phase listener for app-wide chords.
 *
 * - `Mod+B` → toggle the active workbench's left side (Project Home keeps its local focus/collapse rail).
 * - `Mod+J` → toggle the active workbench's right side.
 * - `Ctrl+R` → chat history search rather than browser reload (except inside xterm).
 *
 * Letter chords match `code`, not the layout-dependent produced character. Layout commands intentionally
 * win inside xterm; history does not, because Ctrl+R is the shell's reverse-i-search there.
 */
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
				// One held key must not focus and then immediately collapse the same region.
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
