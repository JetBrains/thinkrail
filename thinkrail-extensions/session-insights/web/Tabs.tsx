import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, type RefObject, useRef } from "react";

export interface TabItem<T extends string> {
	id: T;
	label: ReactNode;
	testId?: string;
	/** Classes for this tab alone (a failing call's Result tab). */
	className?: string | false | undefined;
}

/** The tab a key moves to: ←/→ wrap around, Home and End reach the ends; `null` for any other key. */
export function tabStep(key: string, at: number, count: number): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowRight":
			return at >= count - 1 ? 0 : at + 1;
		case "ArrowLeft":
			return at <= 0 ? count - 1 : at - 1;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

/**
 * A tab list with one tab stop: ←/→ (wrapping), Home and End select and focus a tab. Every tab controls
 * the one panel `tabPanel(id, value)` names, labelled by the selected tab.
 */
export function Tabs<T extends string>({
	id,
	label,
	tabs,
	value,
	onChange,
	className,
	tabClassName,
	listRef,
}: {
	id: string;
	label: string;
	tabs: readonly TabItem<T>[];
	value: T;
	onChange: (value: T) => void;
	className?: string;
	tabClassName?: string;
	listRef?: RefObject<HTMLDivElement | null>;
}) {
	const own = useRef<HTMLDivElement>(null);
	const list = listRef ?? own;
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = tabStep(
			event.key,
			tabs.findIndex((tab) => tab.id === value),
			tabs.length,
		);
		const tab = next === null ? undefined : tabs[next];
		if (!tab) return;
		event.preventDefault();
		onChange(tab.id);
		list.current?.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`)?.focus();
	};
	return (
		<div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={className}>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					id={`${id}-tab-${tab.id}`}
					aria-selected={tab.id === value}
					aria-controls={`${id}-panel`}
					tabIndex={tab.id === value ? 0 : -1}
					data-tab={tab.id}
					data-testid={tab.testId}
					onClick={() => onChange(tab.id)}
					className={cn(
						"border-b-2 tr-text-metadata focus-visible:focus-ring-inset-deep",
						tabClassName,
						tab.id === value
							? "border-primary text-text-default"
							: "border-transparent text-text-muted hover:text-text-default",
						tab.className,
					)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

/** The props of the panel a `Tabs` list controls. */
export function tabPanel(id: string, value: string) {
	return { role: "tabpanel", id: `${id}-panel`, "aria-labelledby": `${id}-tab-${value}` } as const;
}
