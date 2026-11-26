import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useTreeItem } from "@thinkrail/ui/tree-item";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ProviderGlyph } from "@/chat/ProviderGlyph";
import { SETTINGS_ROW_FOCUS } from "@/settingsKit";

const CONTROL = "button, input";

export const MODEL_TREE = "flex flex-col rounded-sm border border-border-default";

export const MODEL_TREE_ROW = cn(
	"flex min-h-40 cursor-default flex-wrap items-center gap-8 border-border-muted border-t py-6 pr-8 transition-colors hover:bg-control-bg-hovered",
	SETTINGS_ROW_FOCUS,
);

export function fromItemControl(
	event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
): boolean {
	const target = event.target;
	if (!(target instanceof Element) || target === event.currentTarget) return false;
	const control = target.closest(CONTROL);
	return control !== null && event.currentTarget.contains(control);
}

function isPlainEnter(event: KeyboardEvent<HTMLElement>): boolean {
	return (
		event.key === "Enter" &&
		event.target === event.currentTarget &&
		!(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) &&
		!isImeComposing(event.nativeEvent)
	);
}

export function stopRowClick(event: MouseEvent<HTMLElement>): void {
	event.stopPropagation();
}

export function ProviderTreeItem({
	id,
	provider,
	meta,
	summary,
	summaryChanged = false,
	expanded,
	testId,
	trailing,
	onToggle,
	onKeyDown,
	children,
}: {
	id: string;
	provider: string;
	meta?: string | null | undefined;
	summary: string;
	summaryChanged?: boolean;
	expanded: boolean;
	testId: string;
	trailing?: (tabIndex: number) => ReactNode;
	onToggle: () => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	children: ReactNode;
}) {
	const {
		role: _treeitem,
		tabIndex,
		...item
	} = useTreeItem(id, {
		level: 1,
		label: provider,
		expanded,
		toggles: true,
	});
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<li role="none" className="flex flex-col [&:first-child>[role=treeitem]]:border-t-0">
			<div
				role="treeitem"
				tabIndex={tabIndex ?? 0}
				{...item}
				data-testid={testId}
				data-provider={provider}
				className={cn(MODEL_TREE_ROW, "pl-8")}
				onClick={(event) => {
					if (!fromItemControl(event)) onToggle();
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					if (event.defaultPrevented || !isPlainEnter(event)) return;
					event.preventDefault();
					onToggle();
				}}
			>
				<Chevron aria-hidden className="size-16 shrink-0 text-text-muted" />
				<ProviderGlyph provider={provider} className="size-14 shrink-0 text-text-muted" />
				<span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-8">
					<span className="tr-text-emphasis text-text-default">{provider}</span>
					{meta ? <span className="text-text-muted tr-text-metadata">{meta}</span> : null}
				</span>
				<span
					className={cn("tr-text-metadata", summaryChanged ? "text-primary" : "text-text-muted")}
				>
					{summary}
				</span>
				{trailing?.(tabIndex ?? 0)}
			</div>
			{expanded ? (
				<ul role="none" className="flex flex-col">
					{children}
				</ul>
			) : null}
		</li>
	);
}
