import { isImeComposing } from "@thinkrail/ui/keyboard";
import {
	hasLayer,
	hasPlatformModifier,
	isTextEntryTarget,
	MODAL_LAYER_SELECTOR,
	platformFamily,
} from "@/lib";
import { dictationFieldOf } from "./field";

export const HOLD_MS = 300;

export function isDictationChord(
	event: Pick<KeyboardEvent, "code" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">,
	platform?: string,
): boolean {
	return (
		event.code === "Space" &&
		event.shiftKey &&
		!event.altKey &&
		hasPlatformModifier(event, platform)
	);
}

export function dictationShortcutLabel(platform?: string): string {
	return platformFamily(platform) === "apple" ? "⌘⇧Space" : "Ctrl+Shift+Space";
}

/**
 * The field the chord dictates into: the focused text field, else, when nothing else owns the
 * keyboard (no modal, no other editor focused), the most recently focused chat composer.
 */
export function chordTarget(
	lastFallback: HTMLElement | null,
	dictating: HTMLElement | null,
): HTMLElement | null {
	if (dictating?.contains(document.activeElement)) return dictating;
	const focused = dictationFieldOf(document.activeElement);
	if (focused) return focused;
	if (hasLayer(document, MODAL_LAYER_SELECTOR) || isTextEntryTarget(document.activeElement)) {
		return null;
	}
	if (lastFallback?.isConnected) return lastFallback;
	return document.querySelector<HTMLElement>("[data-dictation-fallback]");
}

export interface ChordHandlers {
	/** Starts or stops on `target`; returns whether this press started a dictation. */
	press: (target: HTMLElement) => boolean;
	release: () => void;
	lastFallback: () => HTMLElement | null;
	/** The field a dictation is running in: read-only meanwhile, so no longer "eligible". */
	dictating: () => HTMLElement | null;
}

/** ⌘⇧Space / Ctrl+Shift+Space: a tap toggles, holding past `HOLD_MS` is push-to-talk. */
export function installDictationChord(handlers: ChordHandlers): () => void {
	let held: number | null = null;
	const onKeyDown = (event: KeyboardEvent) => {
		if (!isDictationChord(event) || isImeComposing(event)) return;
		const target = chordTarget(handlers.lastFallback(), handlers.dictating());
		if (!target) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat) return;
		target.focus();
		held = handlers.press(target) ? performance.now() : null;
	};
	const onKeyUp = (event: KeyboardEvent) => {
		if (held === null) return;
		if (
			![
				"Space",
				"ShiftLeft",
				"ShiftRight",
				"MetaLeft",
				"MetaRight",
				"ControlLeft",
				"ControlRight",
			].includes(event.code)
		)
			return;
		const at = held;
		held = null;
		if (performance.now() - at >= HOLD_MS) handlers.release();
	};
	window.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("keyup", onKeyUp, true);
	return () => {
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("keyup", onKeyUp, true);
	};
}
