import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { useEffect } from "react";
import { registerSuggestionTarget, SUGGESTION_LIMIT } from "./suggestionTargets";

export interface SuggestionShortcut {
	readonly caps: readonly string[];
	readonly aria: string | undefined;
}

export function SuggestionChips({
	sessionId,
	suggestions,
	onSend,
	onEdit,
	shortcuts,
	chatRoot,
}: {
	sessionId: string;
	suggestions: readonly string[];
	onSend: (text: string) => void;
	onEdit: (text: string) => void;
	shortcuts: readonly SuggestionShortcut[];
	chatRoot: HTMLElement | null;
}) {
	const t = useT();
	useEffect(() => {
		if (!chatRoot) return;
		return registerSuggestionTarget({
			sessionId,
			root: chatRoot,
			suggestions,
			send: onSend,
			edit: onEdit,
		});
	}, [chatRoot, sessionId, suggestions, onSend, onEdit]);
	const shown = suggestions.slice(0, SUGGESTION_LIMIT);
	if (shown.length === 0) return null;
	return (
		<fieldset
			aria-label={t("chat.suggestions.label")}
			data-testid="composer-suggestions"
			className="flex min-w-0 shrink-0 flex-wrap gap-4 px-chat-gutter pt-8"
		>
			{shown.map((suggestion, index) => {
				const shortcut = shortcuts[index];
				return (
					<Button
						key={suggestion}
						variant="outline"
						size="m"
						data-testid="composer-suggestion"
						className="min-w-0 max-w-full"
						aria-keyshortcuts={shortcut?.aria}
						tooltip={t("chat.suggestions.send")}
						tooltipShortcut={shortcut?.caps}
						onClick={(event) => (event.shiftKey ? onEdit : onSend)(suggestion)}
					>
						<span aria-hidden="true" data-testid="composer-suggestion-number">
							<Keycaps keys={[String(index + 1)]} />
						</span>
						<span data-testid="composer-suggestion-text" className="truncate">
							{suggestion}
						</span>
					</Button>
				);
			})}
		</fieldset>
	);
}
