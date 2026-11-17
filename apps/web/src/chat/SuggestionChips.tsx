import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import { useEffect } from "react";
import { LOCAL_KEY_DEFAULTS, SUGGESTION_KEYS } from "@/keybindings";

const TRANSCRIPT = "[data-transcript-feed]";
const COMPOSER = '[data-testid="chat-composer"], [data-testid="composer-suggestions"]';

export function suggestionKeyIndex(id: string | null): number | null {
	const index = id === null ? -1 : SUGGESTION_KEYS.send.indexOf(id);
	return index < 0 ? null : index;
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
	shortcutScope,
}: {
	suggestions: readonly string[];
	onSend: (text: string) => void;
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
			const index = suggestionKeyIndex(keys?.match(event) ?? null);
			const text = index === null ? undefined : suggestions[index];
			if (text === undefined) return;
			event.preventDefault();
			if (!event.repeat) onSend(text);
		};
		shortcutScope.addEventListener("keydown", onKeyDown);
		return () => shortcutScope.removeEventListener("keydown", onKeyDown);
	}, [shortcutScope, suggestions, onSend, composer, transcript]);
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
				return (
					<Button
						key={suggestion}
						variant="outline"
						size="m"
						data-testid="composer-suggestion"
						className="min-w-0 max-w-full"
						aria-keyshortcuts={send ? composer.aria(send) : undefined}
						tooltip={t("chat.suggestions.send")}
						tooltipShortcut={send ? composer.caps(send) : undefined}
						onClick={() => onSend(suggestion)}
					>
						<span className="truncate">{suggestion}</span>
					</Button>
				);
			})}
		</fieldset>
	);
}
