import type { AppLocalScope, ShortcutSurface } from "../keybindings";

const SURFACE_SELECTORS: readonly (readonly [string, ShortcutSurface])[] = [
	[".xterm", "terminal"],
	['[data-testid="chat-composer"]', "composer"],
	["[data-transcript-feed]", "transcript"],
	['[data-testid="history-overlay"]', "history"],
	['[data-testid="changes-review"]', "review"],
	[
		'[data-review-surface], [data-testid="review-composer"], [data-testid="review-thread-card"]',
		"review",
	],
	['[data-key-scope="trees"]', "trees"],
	['[data-key-scope="tabs"]', "tabs"],
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

const LOCAL_SCOPE_SELECTORS: readonly (readonly [string, AppLocalScope])[] = [
	['[data-testid="chat-composer"]', "composer"],
	["[data-transcript-feed]", "transcript"],
	['[data-testid="history-overlay"]', "history"],
	['[data-testid="changes-review"]', "review"],
	[
		'[data-review-surface], [data-testid="review-composer"], [data-testid="review-thread-card"]',
		"review.surface",
	],
	["[data-rail-entry]", "rails"],
	['[data-testid="search-palette"]', "palette"],
	['[data-testid="find-in-files"]', "findInFiles"],
];

interface ScopeNode {
	matches(selector: string): boolean;
	getAttribute(name: string): string | null;
	readonly parentElement: ScopeNode | null;
}

export function localScopesOf(element: ScopeNode | null): string[] {
	const scopes: string[] = [];
	const add = (scope: string) => {
		if (!scopes.includes(scope)) scopes.push(scope);
	};
	for (let node = element; node !== null; node = node.parentElement) {
		const declared = node.getAttribute("data-key-scope");
		if (declared) add(declared);
		for (const [selector, scope] of LOCAL_SCOPE_SELECTORS) {
			if (node.matches(selector)) add(scope);
		}
	}
	return scopes;
}
