import {
	RiLayoutLeft2Fill,
	RiLayoutLeft2Line,
	RiLayoutRight2Fill,
	RiLayoutRight2Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MarkdownOutlineSide } from "../host";
import {
	lastElementAtTop,
	nestOutlineHeadings,
	type OutlineNode,
	revealInList,
	scrollToHeading,
} from "./outlineHeadings";
import type { StampedHeading } from "./sourceLines";

const TOGGLE_ICONS = {
	left: { open: RiLayoutLeft2Fill, closed: RiLayoutLeft2Line },
	right: { open: RiLayoutRight2Fill, closed: RiLayoutRight2Line },
} as const;

function useActiveHeading(
	scroller: HTMLElement | null,
	headings: readonly StampedHeading[],
	enabled: boolean,
): number {
	const [active, setActive] = useState(-1);
	useEffect(() => {
		if (!scroller || !enabled) return;
		const shown = headings.flatMap((heading, index) => (heading.hidden ? [] : [index]));
		const elements = shown.flatMap((index) => headings[index]?.element ?? []);
		let frame = 0;
		const measure = () => {
			frame = 0;
			const found = lastElementAtTop(scroller.getBoundingClientRect().top, elements);
			setActive(shown[Math.max(found, 0)] ?? -1);
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		measure();
		scroller.addEventListener("scroll", schedule, { passive: true });
		return () => {
			scroller.removeEventListener("scroll", schedule);
			cancelAnimationFrame(frame);
		};
	}, [scroller, headings, enabled]);
	return active;
}

function OutlineList({
	nodes,
	active,
	nested = false,
	onSelect,
}: {
	nodes: readonly OutlineNode[];
	active: number;
	nested?: boolean;
	onSelect: (index: number) => void;
}) {
	return (
		<ul className={cn("flex flex-col", nested && "pl-tree-indent")}>
			{nodes.map((node) => {
				const current = node.index === active;
				return (
					<li key={node.index}>
						<button
							type="button"
							data-testid="markdown-outline-entry"
							data-index={node.index}
							aria-current={current ? "location" : undefined}
							title={node.text}
							className={cn(
								"flex h-panel-row w-full min-w-0 items-center rounded-sm px-4 text-left tr-text-ui focus-visible:focus-ring-inset",
								current
									? "bg-control-bg-selected text-text-default"
									: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
							)}
							onClick={() => onSelect(node.index)}
						>
							<span className="min-w-0 truncate">{node.text}</span>
						</button>
						{node.children.length > 0 ? (
							<OutlineList nodes={node.children} active={active} nested onSelect={onSelect} />
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

export function MarkdownOutline({
	headings,
	scroller,
	open,
	side,
	onOpenChange,
}: {
	headings: readonly StampedHeading[];
	scroller: HTMLElement | null;
	open: boolean;
	side: MarkdownOutlineSide;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const toggleSlot = `markdown-outline-toggle${useId()}`;
	const listRef = useRef<HTMLDivElement>(null);
	const tree = useMemo(() => nestOutlineHeadings(headings), [headings]);
	const active = useActiveHeading(scroller, headings, open);

	useEffect(() => {
		const list = listRef.current;
		const entry = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		if (list && entry) revealInList(list, entry);
	}, [active]);

	const select = (index: number) => {
		const heading = headings[index];
		if (scroller && heading) scrollToHeading(scroller, heading.element);
	};
	const label = t("viewer.markdown.outline");
	const icons = TOGGLE_ICONS[side];

	if (!open) {
		return (
			<div className={cn("absolute top-8 z-10", side === "left" ? "left-8" : "right-8")}>
				<IconButton
					icon={icons.closed}
					label={label}
					data-focus-slot={toggleSlot}
					data-testid="markdown-outline-toggle"
					aria-pressed={false}
					onClick={() => onOpenChange(true)}
				/>
			</div>
		);
	}
	return (
		<nav
			data-testid="markdown-outline"
			data-side={side}
			aria-label={label}
			className={cn(
				"flex h-full w-220 shrink-0 flex-col border-border-default bg-container-sidebar-bg",
				side === "left" ? "border-r" : "border-l",
			)}
		>
			<div className="flex h-panel-header-row shrink-0 items-center gap-8 border-border-default border-b pr-4 pl-8">
				<span className="min-w-0 flex-1 truncate text-text-subtle tr-text-eyebrow">{label}</span>
				<IconButton
					icon={icons.open}
					label={label}
					data-focus-slot={toggleSlot}
					data-testid="markdown-outline-toggle"
					aria-pressed
					selected
					onClick={() => onOpenChange(false)}
				/>
			</div>
			<div ref={listRef} className="min-h-0 flex-1 overflow-auto p-4">
				<OutlineList nodes={tree} active={active} onSelect={select} />
			</div>
		</nav>
	);
}
