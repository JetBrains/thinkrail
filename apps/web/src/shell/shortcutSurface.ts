import type { ShortcutSurface } from "../keybindings";

const SURFACE_SELECTORS: readonly (readonly [string, ShortcutSurface])[] = [
	[".xterm", "terminal"],
	['[data-testid="chat-composer"]', "composer"],
	['[data-testid="changes-review"]', "review"],
	['[role="tree"]', "trees"],
	['[role="tablist"], [role="tab"]', "tabs"],
	["[data-rail-entry]", "panels"],
];

export function shortcutSurfaceOf(
	element: Pick<Element, "closest"> | null,
): ShortcutSurface | null {
	if (!element) return null;
	for (const [selector, surface] of SURFACE_SELECTORS) {
		if (element.closest(selector)) return surface;
	}
	return null;
}
