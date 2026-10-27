import { RiSideBarFill as OutlineFill, RiSideBarLine as OutlineLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
	activeHeadingId,
	flattenOutlineHeadings,
	type OutlineHeading,
	scrollHeadingIntoView,
} from "./outlineHeadings";

const NEST_PAD = ["pl-8", "pl-12", "pl-16", "pl-24"] as const;

function nestPad(nest: number): string {
	return NEST_PAD[Math.min(Math.max(nest, 0), NEST_PAD.length - 1)] ?? "pl-8";
}

export function MarkdownOutline({
	headings,
	open,
	scrollerRef,
	onOpenChange,
}: {
	headings: readonly OutlineHeading[];
	open: boolean;
	scrollerRef: RefObject<HTMLElement | null>;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const navRef = useRef<HTMLElement>(null);
	const flat = useMemo(() => flattenOutlineHeadings(headings), [headings]);
	const ids = useMemo(() => flat.map((entry) => entry.heading.id), [flat]);
	const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || !open) return;
		const update = () => {
			const next = activeHeadingId(scroller, ids);
			setActiveId((current) => (current === next ? current : next));
		};
		update();
		scroller.addEventListener("scroll", update, { passive: true });
		return () => scroller.removeEventListener("scroll", update);
	}, [ids, open, scrollerRef]);

	useEffect(() => {
		if (!open || !activeId) return;
		navRef.current
			?.querySelector(`[data-testid="markdown-outline-entry"][data-id="${activeId}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeId, open]);

	const select = (id: string) => {
		const scroller = scrollerRef.current;
		if (scroller) scrollHeadingIntoView(scroller, id);
	};

	return (
		<>
			{open ? (
				<nav
					ref={navRef}
					data-testid="markdown-outline"
					aria-label={t("viewer.markdown.outline")}
					className="flex h-full w-220 shrink-0 flex-col border-border-default border-l bg-container-sidebar-bg"
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
					<div className="min-h-0 flex-1 overflow-auto py-4">
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
				<div className="absolute top-8 right-8 z-10">
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
