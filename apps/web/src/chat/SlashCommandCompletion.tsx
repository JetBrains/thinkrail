import type { SlashCommandInfo } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export type SlashCommandItem = Omit<SlashCommandInfo, "source"> & {
	source: SlashCommandInfo["source"] | "builtin";
};

const MAX_MATCHES = 8;

export async function slashCommandCatalogOrEmpty(
	load: () => Promise<SlashCommandInfo[]>,
): Promise<SlashCommandInfo[]> {
	try {
		return await load();
	} catch {
		return [];
	}
}

export function slashCommandQuery(value: string): string | null {
	return value.startsWith("/") && !/\s/.test(value) ? value.slice(1) : null;
}

export function matchSlashCommands<T extends SlashCommandItem>(
	value: string,
	commands: readonly T[],
): T[] {
	const query = slashCommandQuery(value);
	if (query === null) return [];
	const normalized = query.toLowerCase();
	return commands
		.filter((command) => command.name.toLowerCase().includes(normalized))
		.slice(0, MAX_MATCHES);
}

export function selectedSlashCommandValue(command: SlashCommandItem): string {
	return `/${command.name} `;
}

export type SlashCompletionKeyAction =
	| { type: "none" }
	| { type: "move"; index: number }
	| { type: "select"; index: number }
	| { type: "dismiss" };

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
	nativeEvent?: { isComposing?: boolean };
	isComposing?: boolean;
}

export function useSlashCommandCompletion<T extends SlashCommandItem>({
	value,
	commands,
	onSelect,
}: {
	value: string;
	commands: readonly T[];
	onSelect: (command: T) => void;
}) {
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const query = slashCommandQuery(value);
	const matches = matchSlashCommands(value, commands);

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

	const pick = (command: T) => {
		onSelect(command);
		dismiss();
	};

	const handleKeyDown = (event: CompletionKeyEvent): boolean => {
		if (event.nativeEvent?.isComposing || event.isComposing) return false;
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

export function SlashCommandMenu<T extends SlashCommandItem>({
	commands,
	activeIndex,
	onSelect,
	className,
	footer,
}: {
	commands: readonly T[];
	activeIndex: number;
	onSelect: (command: T) => void;
	className?: string;
	footer?: ReactNode;
}) {
	return (
		<div
			data-testid="slash-menu"
			className={cn(
				"max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-4 shadow-[var(--shadow-md)]",
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
						"flex w-full items-center gap-8 rounded-[var(--radius-sm)] px-8 py-4 text-left tr-text-ui",
						index === activeIndex ? "bg-control-bg-selected text-text-default" : "text-text-muted",
					)}
				>
					<span className="tr-code-text text-text-default">/{command.name}</span>
					{command.description ? (
						<span className="truncate tr-text-metadata">{command.description}</span>
					) : null}
					<span className="ml-auto shrink-0 text-text-muted tr-text-metadata">
						{command.source === "builtin"
							? "Pi/built-in"
							: `${command.source}/${command.sourceInfo.scope}`}
					</span>
				</button>
			))}
			{footer}
		</div>
	);
}
