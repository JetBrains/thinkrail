import { useState } from "react";

/**
 * Fold state that survives virtualization: react-virtuoso unmounts off-screen rows, and a fold the user
 * toggled must not snap back to its default when scrolled away and back (the `AskUserQuestionCard` cache
 * pattern). Keyed by the stable row/step ids from `deriveRows` (`toolCallId` for tool cards), so state
 * also survives re-derivation while streaming. A cache entry only exists once the user toggles — its
 * absence IS the default — which is how "a manual toggle always wins" needs no extra bookkeeping: an
 * untouched fold follows its default (collapsed for activity rows, auto-expand for errored /
 * `defaultExpanded` tool cards), and a toggled fold keeps the user's choice for good. Deliberately never
 * evicted (unlike `AskUserQuestionCard`'s resolve-time drop, which has a natural drop point): growth is
 * bounded by manual toggles — one boolean per user click.
 */
const foldState = new Map<string, boolean>();

/**
 * Expanded state backed by the module cache. `fallback` is the fold's *current* default — it may flip
 * over time (e.g. `ToolCard`'s auto-expand on error/completion) and applies until the user toggles;
 * after that the cached manual choice wins, across virtualization remounts and streaming re-derivations.
 */
export function useFold(id: string, fallback = false): [boolean, () => void] {
	const [override, setOverride] = useState<boolean | undefined>(() => foldState.get(id));
	const expanded = override ?? fallback;
	const toggle = () => {
		const next = !expanded;
		foldState.set(id, next);
		setOverride(next);
	};
	return [expanded, toggle];
}
