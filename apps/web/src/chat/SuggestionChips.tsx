import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import { useEffect } from "react";
import { LOCAL_KEY_DEFAULTS, SUGGESTION_KEYS } from "@/keybindings";

const TRANSCRIPT = "[data-transcript-feed]";
const COMPOSER = '[data-testid="chat-composer"], [data-testid="composer-suggestions"]';

export interface SuggestionKeyAction {
	readonly index: number;
	readonly edit: boolean;
}

export function suggestionKeyAction(id: string | null): SuggestionKeyAction | null {
	if (id === null) return null;
	const send = SUGGESTION_KEYS.send.indexOf(id);
	if (send >= 0) return { index: send, edit: false };
	const edit = SUGGESTION_KEYS.edit.indexOf(id);
	return edit >= 0 ? { index: edit, edit: true } : null;
}

export function suggestionKeysFor(
	target: EventTarget | null,
	keys: { composer: LocalKeys; transcript: LocalKeys },
): LocalKeys | null {
	if (!(target instanceof Element)) return null;
	if (target.closest(TRANSCRIPT)) return keys.transcript;
	return target.closest(COMPOSER) ? keys.composer : null;
}

export function SuggestionChips({
	suggestions,
	onSend,
	onEdit,
	shortcutScope,
}: {
	suggestions: readonly string[];
	onSend: (text: string) => void;
	onEdit: (text: string) => void;
	shortcutScope?: HTMLElement | null | undefined;
}) {
	const t = useT();
	const composer = useLocalKeys("composer", LOCAL_KEY_DEFAULTS.composer);
	const transcript = useLocalKeys("transcript", LOCAL_KEY_DEFAULTS.transcript);
	useEffect(() => {
		if (!shortcutScope || suggestions.length === 0) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const keys = suggestionKeysFor(event.target, { composer, transcript });
			const action = suggestionKeyAction(keys?.match(event) ?? null);
			const text = action === null ? undefined : suggestions[action.index];
			if (action === null || text === undefined) return;
			event.preventDefault();
			if (!event.repeat) (action.edit ? onEdit : onSend)(text);
		};
		shortcutScope.addEventListener("keydown", onKeyDown);
		return () => shortcutScope.removeEventListener("keydown", onKeyDown);
	}, [shortcutScope, suggestions, onSend, onEdit, composer, transcript]);
	if (suggestions.length === 0) return null;
	return (
		<fieldset
			aria-label={t("chat.suggestions.label")}
			data-testid="composer-suggestions"
			data-key-scope="composer"
			className="flex min-w-0 shrink-0 flex-wrap gap-4 px-chat-gutter pt-8"
		>
			{suggestions.map((suggestion, index) => {
				const send = SUGGESTION_KEYS.send[index];
				const edit = SUGGESTION_KEYS.edit[index];
				return (
					<Button
						key={suggestion}
						variant="outline"
						size="m"
						data-testid="composer-suggestion"
						className="min-w-0 max-w-full"
						aria-keyshortcuts={send && edit ? composer.aria(send, edit) : undefined}
						tooltip={t("chat.suggestions.send")}
						tooltipShortcut={send ? composer.caps(send) : undefined}
						onClick={(event) => (event.shiftKey ? onEdit : onSend)(suggestion)}
					>
						<span className="truncate">{suggestion}</span>
					</Button>
				);
			})}
		</fieldset>
	);
}
