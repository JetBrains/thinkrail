import { RiSideBarFill as OutlineFill, RiSideBarLine as OutlineLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
	activeHeadingIdFromElements,
	flattenOutlineHeadings,
	type OutlineHeading,
	resolveHeadingElements,
	scrollHeadingIntoView,
} from "./outlineHeadings";

const NEST_PAD = ["pl-8", "pl-12", "pl-16", "pl-24"] as const;

function nestPad(nest: number): string {
	return NEST_PAD[Math.min(Math.max(nest, 0), NEST_PAD.length - 1)] ?? "pl-8";
}

// Adjust only the list's own scrollTop: scrollIntoView would also scroll every ancestor, such as an
// enclosing chat transcript that mounts this preview offscreen.
export function revealInList(list: HTMLElement, entry: HTMLElement): void {
	const listRect = list.getBoundingClientRect();
	const entryRect = entry.getBoundingClientRect();
	if (entryRect.top < listRect.top) list.scrollTop -= listRect.top - entryRect.top;
	else if (entryRect.bottom > listRect.bottom) list.scrollTop += entryRect.bottom - listRect.bottom;
}

export function MarkdownOutline({
	headings,
	open,
	side = "right",
	scrollerRef,
	onOpenChange,
}: {
	headings: readonly OutlineHeading[];
	open: boolean;
	side?: "left" | "right";
	scrollerRef: RefObject<HTMLElement | null>;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const listRef = useRef<HTMLDivElement>(null);
	const flat = useMemo(() => flattenOutlineHeadings(headings), [headings]);
	const ids = useMemo(() => flat.map((entry) => entry.heading.id), [flat]);
	const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || !open) return;
		// Resolve heading elements once and re-resolve only when one has been replaced, then coalesce
		// scroll events to one indexed lookup per frame.
		let elements = resolveHeadingElements(scroller, ids);
		let frame: number | null = null;
		const measure = () => {
			frame = null;
			if (elements.some(({ element }) => !element.isConnected))
				elements = resolveHeadingElements(scroller, ids);
			const next = activeHeadingIdFromElements(scroller, elements, ids[0] ?? null);
			setActiveId((current) => (current === next ? current : next));
		};
		const schedule = () => {
			if (frame === null) frame = requestAnimationFrame(measure);
		};
		measure();
		scroller.addEventListener("scroll", schedule, { passive: true });
		return () => {
			scroller.removeEventListener("scroll", schedule);
			if (frame !== null) cancelAnimationFrame(frame);
		};
	}, [ids, open, scrollerRef]);

	useEffect(() => {
		if (!open || !activeId) return;
		const list = listRef.current;
		const entry = list?.querySelector<HTMLElement>(
			`[data-testid="markdown-outline-entry"][data-id="${activeId}"]`,
		);
		if (list && entry) revealInList(list, entry);
	}, [activeId, open]);

	const select = (id: string) => {
		const scroller = scrollerRef.current;
		if (scroller) scrollHeadingIntoView(scroller, id);
	};

	return (
		<>
			{open ? (
				<nav
					data-testid="markdown-outline"
					aria-label={t("viewer.markdown.outline")}
					data-side={side}
					className={cn(
						"flex h-full w-220 shrink-0 flex-col border-border-default bg-container-sidebar-bg",
						side === "left" ? "border-r" : "border-l",
					)}
				>
					<div className="flex h-panel-header-row shrink-0 items-center gap-8 border-border-default border-b px-8">
						<span className="min-w-0 flex-1 truncate tr-text-eyebrow text-text-subtle">
							{t("viewer.markdown.outline")}
						</span>
						<IconButton
							icon={OutlineFill}
							label={t("viewer.markdown.hideOutline")}
							data-testid="markdown-outline-toggle"
							aria-pressed={true}
							selected
							onClick={() => onOpenChange(false)}
						/>
					</div>
					<div ref={listRef} className="min-h-0 flex-1 overflow-auto py-4">
						<ul className="flex flex-col">
							{flat.map(({ heading, nest }) => {
								const current = heading.id === activeId;
								return (
									<li key={heading.id}>
										<button
											type="button"
											data-testid="markdown-outline-entry"
											data-id={heading.id}
											aria-current={current ? "true" : undefined}
											className={cn(
												"flex w-full min-w-0 rounded-sm py-4 pr-8 text-left tr-text-ui",
												nestPad(nest),
												current
													? "bg-control-bg-selected text-text-default"
													: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
											)}
											onClick={() => select(heading.id)}
										>
											<span className="truncate">{heading.text}</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				</nav>
			) : (
				<div className={cn("absolute top-8 z-10", side === "left" ? "left-8" : "right-8")}>
					<IconButton
						icon={OutlineLine}
						label={t("viewer.markdown.showOutline")}
						data-testid="markdown-outline-toggle"
						aria-pressed={false}
						onClick={() => onOpenChange(true)}
					/>
				</div>
			)}
		</>
	);
}
