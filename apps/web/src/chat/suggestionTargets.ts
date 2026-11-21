import { SUGGESTION_KEYS } from "@/keybindings";

export interface SuggestionKeyAction {
	readonly index: number;
	readonly edit: boolean;
}

const SEND_KEYS: readonly string[] = SUGGESTION_KEYS.send;
const EDIT_KEYS: readonly string[] = SUGGESTION_KEYS.edit;

export function suggestionKeyAction(id: string | null): SuggestionKeyAction | null {
	if (id === null) return null;
	const send = SEND_KEYS.indexOf(id);
	if (send >= 0) return { index: send, edit: false };
	const edit = EDIT_KEYS.indexOf(id);
	return edit >= 0 ? { index: edit, edit: true } : null;
}

export const SUGGESTION_LIMIT = SEND_KEYS.length;

export interface SuggestionTarget {
	readonly sessionId: string;
	readonly root: Pick<Node, "contains">;
	readonly suggestions: readonly string[];
	readonly send: (text: string) => void;
	readonly edit: (text: string) => void;
}

const targets = new Set<SuggestionTarget>();

export function registerSuggestionTarget(target: SuggestionTarget): () => void {
	targets.add(target);
	return () => {
		targets.delete(target);
	};
}

export function suggestionTargetFor(
	focused: Node | null,
	fallbackSessionId: string | null,
	registered: Iterable<SuggestionTarget> = targets,
): SuggestionTarget | null {
	let fallback: SuggestionTarget | null = null;
	for (const target of registered) {
		if (focused !== null && target.root.contains(focused)) return target;
		if (target.sessionId === fallbackSessionId) fallback = target;
	}
	return fallback;
}

export function suggestionAt(target: SuggestionTarget | null, index: number): string | undefined {
	return index < SUGGESTION_LIMIT ? target?.suggestions[index] : undefined;
}

export function runSuggestion(target: SuggestionTarget, action: SuggestionKeyAction): boolean {
	const text = suggestionAt(target, action.index);
	if (text === undefined) return false;
	(action.edit ? target.edit : target.send)(text);
	return true;
}
