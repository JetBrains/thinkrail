import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { SearchFilterKey, SearchVocabulary } from "@thinkrail/pi-session-insights/core";
import { IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Popover, PopoverAnchor, PopoverContent } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type RefObject, useId, useState } from "react";
import { formatCount } from "../format";
import { FILTER_LABEL } from "./copy";
import { applySuggestion, type Suggestion, suggestionsFor, tokenAt } from "./query";

const QUERY_CHARS = 500;
/** Values that are technical text (a tool, a path, an error line) read in the code face; names do not. */
const CODE_VALUES: readonly SearchFilterKey[] = ["tool", "file", "error"];

function suggestionKey(suggestion: Suggestion): string {
	return suggestion.kind === "key"
		? `key:${suggestion.key}`
		: `${suggestion.key}:${suggestion.value}`;
}

/**
 * The search field of the list panel's toolbar: free text and `key:value` filters, with the scope's
 * values suggested for the filter under the caret (↑/↓ choose, Enter or Tab take, Esc closes).
 */
export function SearchBox({
	value,
	onChange,
	onFocus,
	onEscape,
	onToResults,
	vocabulary,
	keys,
	inputRef,
}: {
	value: string;
	onChange: (value: string) => void;
	onFocus: () => void;
	/** Esc with no suggestions open. */
	onEscape: () => void;
	/** ↓ with no suggestions open: into the results. */
	onToResults: () => void;
	vocabulary: SearchVocabulary | null;
	keys: readonly SearchFilterKey[];
	inputRef: RefObject<HTMLInputElement | null>;
}) {
	const t = useT();
	const locale = localeOf(t);
	const listId = useId();
	const [caret, setCaret] = useState(0);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	const token = tokenAt(value, Math.min(caret, value.length), keys);
	const suggestions = open ? suggestionsFor(token, vocabulary, keys) : [];
	const shown = suggestions.length > 0;
	const picked = active >= 0 && active < suggestions.length ? active : -1;

	const move = (next: string, at: number) => {
		onChange(next);
		setCaret(at);
		setOpen(true);
		setActive(-1);
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(at, at);
			setActive(tokenAt(next, at, keys).key ? 0 : -1);
		});
	};
	const take = (suggestion: Suggestion) => {
		const applied = applySuggestion(value, token, suggestion);
		move(applied.text, applied.caret);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event.nativeEvent)) return;
		if (shown && event.key === "ArrowDown") {
			event.preventDefault();
			setActive((picked + 1) % suggestions.length);
			return;
		}
		if (shown && event.key === "ArrowUp") {
			event.preventDefault();
			setActive(picked <= 0 ? suggestions.length - 1 : picked - 1);
			return;
		}
		const choice = suggestions[Math.max(picked, 0)];
		if (shown && choice && (event.key === "Tab" || (event.key === "Enter" && picked >= 0))) {
			event.preventDefault();
			take(choice);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			if (shown) setOpen(false);
			else onEscape();
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			onToResults();
		}
	};
	const sync = (input: HTMLInputElement) => setCaret(input.selectionStart ?? input.value.length);
	const optionId = (index: number) => `${listId}-option-${index}`;

	return (
		<Popover open={shown}>
			<PopoverAnchor asChild>
				<span className="flex h-panel-header-control min-w-160 max-w-640 flex-1 items-center gap-4 rounded-sm border border-control-border-default bg-control-bg px-4 focus-within:border-control-border-active has-[input:focus-visible]:focus-ring">
					<RiSearchLine aria-hidden className="size-14 shrink-0 text-text-subtle" />
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						data-testid="session-insights-search"
						value={value}
						maxLength={QUERY_CHARS}
						spellCheck={false}
						autoComplete="off"
						placeholder={t("sessionInsights.search.placeholder")}
						aria-label={t("sessionInsights.search.label")}
						aria-expanded={shown}
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={shown && picked >= 0 ? optionId(picked) : undefined}
						onFocus={(event) => {
							sync(event.currentTarget);
							setOpen(true);
							onFocus();
						}}
						onBlur={() => setOpen(false)}
						onChange={(event) => {
							const input = event.currentTarget;
							onChange(input.value);
							sync(input);
							setOpen(true);
							setActive(tokenAt(input.value, input.selectionStart ?? 0, keys).key ? 0 : -1);
						}}
						onSelect={(event) => sync(event.currentTarget)}
						onKeyDown={onKeyDown}
						className="h-full min-w-0 flex-1 bg-transparent tr-text-metadata text-text-default outline-none placeholder:text-text-subtle"
					/>
					{value ? (
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("sessionInsights.search.clear")}
							data-testid="session-insights-search-clear"
							onClick={() => move("", 0)}
						/>
					) : (
						<kbd className="shrink-0 rounded-xs border border-border-default px-4 tr-code-text-small text-text-subtle">
							{t("sessionInsights.search.slash")}
						</kbd>
					)}
				</span>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				sideOffset={4}
				className="w-416 max-w-full p-4"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<div
					id={listId}
					role="listbox"
					aria-label={t("sessionInsights.search.suggestions")}
					data-testid="session-insights-search-suggestions"
					className="flex flex-col"
				>
					{token.key ? (
						<span className="px-8 pt-2 pb-4 tr-text-metadata text-text-subtle">
							{t("sessionInsights.search.suggestionsFor", { key: t(FILTER_LABEL[token.key]) })}
						</span>
					) : null}
					{suggestions.map((suggestion, index) => (
						<div
							key={suggestionKey(suggestion)}
							id={optionId(index)}
							role="option"
							tabIndex={-1}
							aria-selected={index === picked}
							data-testid="session-insights-search-suggestion"
							data-key={suggestion.key}
							data-value={suggestion.kind === "value" ? suggestion.value : ""}
							onMouseDown={(event) => event.preventDefault()}
							onMouseMove={() => setActive(index)}
							onClick={() => take(suggestion)}
							onKeyDown={(event) => {
								if (event.key === "Enter") take(suggestion);
							}}
							className={cn(
								"flex min-w-0 cursor-pointer items-center gap-8 rounded-sm px-8 py-2 tr-text-metadata",
								index === picked ? "bg-control-bg-selected text-text-default" : "text-text-muted",
							)}
						>
							<span className="shrink-0 tr-code-text-small text-primary">{`${suggestion.key}:`}</span>
							{suggestion.kind === "value" ? (
								<>
									<span
										className={cn(
											"min-w-0 truncate text-text-default",
											CODE_VALUES.includes(suggestion.key) ? "tr-code-text-small" : null,
										)}
									>
										{suggestion.value}
									</span>
									{suggestion.count !== null ? (
										<span className="ml-auto shrink-0 tabular-nums text-text-subtle">
											{t("sessionInsights.search.events", {
												count: suggestion.count,
												formatted: formatCount(locale, suggestion.count),
											})}
										</span>
									) : null}
								</>
							) : (
								<span className="min-w-0 truncate text-text-subtle">
									{t(FILTER_LABEL[suggestion.key])}
								</span>
							)}
						</div>
					))}
					<span className="flex items-center gap-8 border-border-muted border-t px-8 pt-4 pb-2 tr-text-metadata text-text-subtle">
						{t("sessionInsights.search.suggestionKeys")}
					</span>
				</div>
			</PopoverContent>
		</Popover>
	);
}
