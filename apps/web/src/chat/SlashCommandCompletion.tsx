import type { SlashCommandInfo } from "@thinkrail/contracts";
import { useState } from "react";
import { cn } from "@/lib/utils";

const MAX_MATCHES = 8;

/** Optional autocomplete catalogs degrade to empty; catalog failure must never block the owning form. */
export async function slashCommandCatalogOrEmpty(
	load: () => Promise<SlashCommandInfo[]>,
): Promise<SlashCommandInfo[]> {
	try {
		return await load();
	} catch {
		return [];
	}
}

/** Slash commands are recognized only at the start of a message and before the first whitespace. */
export function slashCommandQuery(value: string): string | null {
	return value.startsWith("/") && !/\s/.test(value) ? value.slice(1) : null;
}

export function matchSlashCommands(
	value: string,
	commands: readonly SlashCommandInfo[],
): SlashCommandInfo[] {
	const query = slashCommandQuery(value);
	if (query === null) return [];
	const normalized = query.toLowerCase();
	return commands
		.filter((command) => command.name.toLowerCase().includes(normalized))
		.slice(0, MAX_MATCHES);
}

/** The exact text both chat and New Workspace insert for a selected command. */
export function selectedSlashCommandValue(command: SlashCommandInfo): string {
	return `/${command.name} `;
}

export type SlashCompletionKeyAction =
	| { type: "none" }
	| { type: "move"; index: number }
	| { type: "select"; index: number }
	| { type: "dismiss" };

/** Pure keyboard reducer — shared behavior without coupling callers to a particular textarea. */
export function slashCompletionKeyAction(
	key: string,
	open: boolean,
	activeIndex: number,
	matchCount: number,
): SlashCompletionKeyAction {
	if (!open || matchCount === 0) return { type: "none" };
	if (key === "ArrowDown") return { type: "move", index: (activeIndex + 1) % matchCount };
	if (key === "ArrowUp") {
		return { type: "move", index: (activeIndex - 1 + matchCount) % matchCount };
	}
	if (key === "Enter" || key === "Tab") return { type: "select", index: activeIndex };
	if (key === "Escape") return { type: "dismiss" };
	return { type: "none" };
}

interface CompletionKeyEvent {
	key: string;
	preventDefault: () => void;
	stopPropagation: () => void;
}

/** Shared query, selection, dismissal, and keyboard state for slash-command inputs. */
export function useSlashCommandCompletion({
	value,
	commands,
	onSelect,
}: {
	value: string;
	commands: readonly SlashCommandInfo[];
	onSelect: (command: SlashCommandInfo) => void;
}) {
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const query = slashCommandQuery(value);
	const matches = matchSlashCommands(value, commands);

	// Reset the highlight + dismissal whenever the query or the command set changes — done during render via
	// a tracked signal (React's "adjust state on prop change" pattern) rather than an effect, so it needs no
	// dependency-lint suppression. The signal keys off the command *names* (a stable content identity), so an
	// unstable `commands` array reference can neither spuriously reset nor loop.
	const resetSignal = JSON.stringify([query, commands.map((command) => command.name)]);
	const [lastResetSignal, setLastResetSignal] = useState(resetSignal);
	if (lastResetSignal !== resetSignal) {
		setLastResetSignal(resetSignal);
		setActiveIndex(0);
		setDismissed(false);
	}

	const open = !dismissed && query !== null && matches.length > 0;
	const visibleActiveIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));

	const dismiss = () => setDismissed(true);

	const pick = (command: SlashCommandInfo) => {
		onSelect(command);
		dismiss();
	};

	const handleKeyDown = (event: CompletionKeyEvent): boolean => {
		const action = slashCompletionKeyAction(event.key, open, visibleActiveIndex, matches.length);
		if (action.type === "none") return false;
		event.preventDefault();
		event.stopPropagation();
		if (action.type === "move") setActiveIndex(action.index);
		if (action.type === "dismiss") dismiss();
		if (action.type === "select") {
			const command = matches[action.index];
			if (command) pick(command);
		}
		return true;
	};

	return { activeIndex: visibleActiveIndex, dismiss, handleKeyDown, matches, open, pick };
}

/** Presentational command list shared by the chat composer and New Workspace prompt. */
export function SlashCommandMenu({
	commands,
	activeIndex,
	onSelect,
	className,
}: {
	commands: readonly SlashCommandInfo[];
	activeIndex: number;
	onSelect: (command: SlashCommandInfo) => void;
	className?: string;
}) {
	return (
		<div
			data-testid="slash-menu"
			className={cn(
				"max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border2 bg-elevated p-xs shadow-[var(--shadow-md)]",
				className,
			)}
		>
			{commands.map((command, index) => (
				<button
					key={`${command.source}:${command.sourceInfo.path}:${command.name}`}
					type="button"
					data-testid="slash-command"
					data-source={command.source}
					onClick={() => onSelect(command)}
					className={cn(
						"flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left text-sm",
						index === activeIndex ? "bg-hover text-text" : "text-muted",
					)}
				>
					<span className="font-mono text-text">/{command.name}</span>
					{command.description ? (
						<span className="truncate text-xs">{command.description}</span>
					) : null}
					<span className="ml-auto shrink-0 text-hint text-xs">
						{command.source}/{command.sourceInfo.scope}
					</span>
				</button>
			))}
		</div>
	);
}
