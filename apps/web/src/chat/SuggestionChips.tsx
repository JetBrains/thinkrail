import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect } from "react";
import { platformFamily } from "../lib";
import { composerSuggestionIndex } from "./composerSuggestions";

export function suggestionShortcutLabel(index: number, platform?: string): string {
	const key = String(index + 1);
	return platformFamily(platform) === "apple" ? `⌥${key}` : `Alt+${key}`;
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
	useEffect(() => {
		if (!shortcutScope || suggestions.length === 0) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const index = composerSuggestionIndex(event);
			const text = index === null ? undefined : suggestions[index];
			if (!text || event.defaultPrevented) return;
			event.preventDefault();
			onSend(text);
		};
		shortcutScope.addEventListener("keydown", onKeyDown);
		return () => shortcutScope.removeEventListener("keydown", onKeyDown);
	}, [shortcutScope, suggestions, onSend]);
	if (suggestions.length === 0) return null;
	return (
		<fieldset
			aria-label={t("chat.suggestions.label")}
			data-testid="composer-suggestions"
			className="flex min-w-0 shrink-0 flex-wrap gap-4 px-chat-gutter pt-8"
		>
			{suggestions.map((suggestion, index) => (
				<Button
					key={suggestion}
					variant="outline"
					size="m"
					data-testid="composer-suggestion"
					className="min-w-0 max-w-full"
					tooltip={
						index < 9
							? t("chat.suggestions.send", { shortcut: suggestionShortcutLabel(index) })
							: undefined
					}
					onClick={() => onSend(suggestion)}
				>
					<span className="truncate">{suggestion}</span>
				</Button>
			))}
		</fieldset>
	);
}
