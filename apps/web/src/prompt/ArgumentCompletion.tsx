import type { SlashArgumentCompletion } from "@thinkrail/contracts";
import { Popover, PopoverAnchor, PopoverContent } from "@thinkrail/ui/popover";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, type RefObject, useState } from "react";
import type { SlashCommandItem } from "./SlashCommandCompletion";

export interface SlashArgument<T extends SlashCommandItem> {
	command: T & { argumentCompletion: SlashArgumentCompletion };
	query: string;
	start: number;
}

const COMMAND_WITH_ARGUMENT = /^\/(\S+) ([^\n]*)$/;

export function slashArgument<T extends SlashCommandItem>(
	value: string,
	commands: readonly T[],
): SlashArgument<T> | null {
	const match = COMMAND_WITH_ARGUMENT.exec(value);
	if (!match) return null;
	const [, name = "", query = ""] = match;
	const command = commands.find((candidate) => candidate.name === name);
	if (!command?.argumentCompletion) return null;
	return {
		command: command as T & { argumentCompletion: SlashArgumentCompletion },
		query,
		start: name.length + 2,
	};
}

export function replaceSlashArgument(
	value: string,
	argument: { start: number },
	text: string,
): string {
	return `${value.slice(0, argument.start)}${text} `;
}

export type PromptTintTone = "plain" | "command" | "argument";

export interface PromptTintSegment {
	text: string;
	tone: PromptTintTone;
	start: number;
}

export function slashArgumentTint(
	value: string,
	argument: { start: number } | null,
	argumentLength: number,
): PromptTintSegment[] {
	if (!argument) return [{ text: value, tone: "plain", start: 0 }];
	const commandEnd = argument.start - 1;
	const argumentEnd = argument.start + argumentLength;
	const span = (start: number, end: number, tone: PromptTintTone): PromptTintSegment => ({
		text: value.slice(start, end),
		tone,
		start,
	});
	return [
		span(0, commandEnd, "command"),
		span(commandEnd, argument.start, "plain"),
		span(argument.start, argumentEnd, "argument"),
		span(argumentEnd, value.length, "plain"),
	].filter((segment) => segment.text.length > 0);
}

export type ArgumentCompletionKeyAction =
	| { type: "none" }
	| { type: "move"; index: number }
	| { type: "pick"; index: number }
	| { type: "tab"; backwards: boolean }
	| { type: "dismiss" };

export function argumentCompletionKeyAction(
	key: string,
	shiftKey: boolean,
	{
		open,
		itemCount,
		activeIndex,
		tabs,
	}: { open: boolean; itemCount: number; activeIndex: number; tabs: boolean },
): ArgumentCompletionKeyAction {
	if (!open) return { type: "none" };
	if (key === "Escape") return { type: "dismiss" };
	if (key === "Tab") return tabs ? { type: "tab", backwards: shiftKey } : { type: "none" };
	if (itemCount === 0) return { type: "none" };
	if (key === "ArrowDown") return { type: "move", index: (activeIndex + 1) % itemCount };
	if (key === "ArrowUp") return { type: "move", index: (activeIndex - 1 + itemCount) % itemCount };
	if (key === "Enter" && !shiftKey) return { type: "pick", index: activeIndex };
	return { type: "none" };
}

interface CompletionKeyEvent {
	key: string;
	shiftKey?: boolean;
	preventDefault: () => void;
	stopPropagation: () => void;
}

export function useArgumentCompletion<T extends SlashCommandItem>({
	value,
	commands,
	itemCount,
	isComplete,
	onPick,
	onTab,
}: {
	value: string;
	commands: readonly T[];
	itemCount: number;
	isComplete: (argument: SlashArgument<T>) => boolean;
	onPick: (index: number) => void;
	onTab?: (backwards: boolean) => void;
}) {
	const argument = slashArgument(value, commands);
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const resetSignal = argument ? `${argument.command.name}\u0000${argument.query}` : "";
	const [lastResetSignal, setLastResetSignal] = useState(resetSignal);
	if (lastResetSignal !== resetSignal) {
		setLastResetSignal(resetSignal);
		setActiveIndex(0);
		setDismissed(false);
	}

	const open = argument !== null && !dismissed && !isComplete(argument);
	const visibleActiveIndex = Math.min(activeIndex, Math.max(0, itemCount - 1));

	const handleKeyDown = (event: CompletionKeyEvent): boolean => {
		const action = argumentCompletionKeyAction(event.key, event.shiftKey === true, {
			open,
			itemCount,
			activeIndex: visibleActiveIndex,
			tabs: onTab !== undefined,
		});
		if (action.type === "none") return false;
		event.preventDefault();
		event.stopPropagation();
		if (action.type === "move") setActiveIndex(action.index);
		if (action.type === "pick") onPick(action.index);
		if (action.type === "tab") onTab?.(action.backwards);
		if (action.type === "dismiss") setDismissed(true);
		return true;
	};

	return {
		argument: open ? argument : null,
		activeIndex: visibleActiveIndex,
		setActiveIndex,
		dismiss: () => setDismissed(true),
		handleKeyDown,
	};
}

/**
 * Opens above `anchor` and never past the window's top edge: it shrinks to the space left above the
 * prompt, and only its rows scroll, so the header (the caller's filters) always stays in view.
 */
export function ArgumentCompletionMenu({
	anchor,
	container = null,
	children,
	className,
}: {
	anchor: RefObject<HTMLElement | null>;
	container?: HTMLElement | null;
	children: ReactNode;
	className?: string;
}) {
	return (
		<Popover open>
			<PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
			<PopoverContent
				side="top"
				align="start"
				sideOffset={4}
				collisionPadding={8}
				avoidCollisions={false}
				container={container}
				data-testid="argument-menu"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				className={cn(
					"flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] flex-col p-0",
					className,
				)}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}

/** The menu's three bands: a fixed header and footer around the rows, which alone scroll. */
export function ArgumentCompletionFrame({
	header,
	footer,
	children,
}: {
	header?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			{header ? <div className="shrink-0 border-border-muted border-b">{header}</div> : null}
			<div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
			{footer ? <div className="shrink-0 border-border-muted border-t">{footer}</div> : null}
		</>
	);
}

export function promptTintClass(tone: PromptTintTone): string {
	switch (tone) {
		case "command":
			return "rounded-xs bg-primary-subtle";
		case "argument":
			return "rounded-xs bg-primary-soft";
		case "plain":
			return "";
	}
}
