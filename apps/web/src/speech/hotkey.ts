import {
	hasLayer,
	hasPlatformModifier,
	isTextEntryTarget,
	MODAL_LAYER_SELECTOR,
	platformFamily,
} from "@/lib";

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

export interface ChordTarget {
	element: () => HTMLElement | null;
	press: () => boolean;
	release: () => void;
	fallback: boolean;
}

const targets = new Map<string, ChordTarget>();
let lastFallback: string | null = null;
let held: { id: string; at: number } | null = null;
let installed = false;

function focusedTarget(): [string, ChordTarget] | null {
	const active = document.activeElement;
	for (const entry of targets) {
		const element = entry[1].element();
		if (element && active && element.contains(active)) return entry;
	}
	return null;
}

function fallbackTarget(): [string, ChordTarget] | null {
	if (hasLayer(document, MODAL_LAYER_SELECTOR) || isTextEntryTarget(document.activeElement)) {
		return null;
	}
	const remembered = lastFallback ? targets.get(lastFallback) : undefined;
	if (lastFallback && remembered?.fallback && remembered.element()?.isConnected) {
		return [lastFallback, remembered];
	}
	let found: [string, ChordTarget] | null = null;
	for (const entry of targets)
		if (entry[1].fallback && entry[1].element()?.isConnected) found = entry;
	return found;
}

function onKeyDown(event: KeyboardEvent): void {
	if (!isDictationChord(event)) return;
	const entry = focusedTarget() ?? fallbackTarget();
	if (!entry) return;
	event.preventDefault();
	event.stopPropagation();
	if (event.repeat) return;
	const [id, target] = entry;
	target.element()?.focus();
	held = target.press() ? { id, at: performance.now() } : null;
}

function onKeyUp(event: KeyboardEvent): void {
	if (!held) return;
	if (
		event.code !== "Space" &&
		event.key !== "Shift" &&
		event.key !== "Meta" &&
		event.key !== "Control"
	)
		return;
	const { id, at } = held;
	held = null;
	if (performance.now() - at >= HOLD_MS) targets.get(id)?.release();
}

export function registerChordTarget(id: string, target: ChordTarget): () => void {
	targets.set(id, target);
	if (!installed) {
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		installed = true;
	}
	return () => {
		targets.delete(id);
		if (lastFallback === id) lastFallback = null;
		if (held?.id === id) held = null;
		if (targets.size === 0 && installed) {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp, true);
			installed = false;
		}
	};
}

export function noteFallbackFocus(id: string): void {
	if (targets.get(id)?.fallback) lastFallback = id;
}
