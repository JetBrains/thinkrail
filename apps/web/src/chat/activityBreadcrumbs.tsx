import {
	RiBrainLine as Brain,
	RiArrowRightSLine as ChevronRight,
	RiStackLine as Layers,
	RiToolsLine as Tools,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";

export type ActivityBreadcrumbKind = "activity" | "thinking" | "tool";

export interface ActivityBreadcrumbDescriptor {
	id: string;
	parentId?: string;
	kind: ActivityBreadcrumbKind;
	label: string;
	meta: string;
	expanded: boolean;
}

export interface ActivityBreadcrumbGeometry extends ActivityBreadcrumbDescriptor {
	top: number;
	bottom: number;
}

export interface ActivityBreadcrumbEllipsis {
	id: "ellipsis";
	kind: "ellipsis";
}

export type ActivityBreadcrumbSegment = ActivityBreadcrumbDescriptor | ActivityBreadcrumbEllipsis;

export const ACTIVITY_BREADCRUMB_HEIGHT = 34;
const ACTIVITY_BREADCRUMB_COMPACT_WIDTH = 520;

export function isCompactBreadcrumbWidth(width: number): boolean {
	return width < ACTIVITY_BREADCRUMB_COMPACT_WIDTH;
}

export function activityBreadcrumbJumpTop(
	scrollTop: number,
	scrollerTop: number,
	nodeTop: number,
): number {
	return Math.max(0, scrollTop + nodeTop - scrollerTop - ACTIVITY_BREADCRUMB_HEIGHT);
}

export function deriveActiveBreadcrumbPath(
	nodes: ActivityBreadcrumbGeometry[],
	boundary: number,
): ActivityBreadcrumbDescriptor[] {
	const active = new Map(
		nodes
			.filter((node) => node.expanded && node.top < boundary && node.bottom > boundary)
			.map((node) => [node.id, node]),
	);
	let best: ActivityBreadcrumbGeometry[] = [];
	for (const leaf of active.values()) {
		const chain: ActivityBreadcrumbGeometry[] = [];
		const seen = new Set<string>();
		let current: ActivityBreadcrumbGeometry | undefined = leaf;
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			chain.unshift(current);
			current = current.parentId ? active.get(current.parentId) : undefined;
		}
		if (chain[0]?.parentId !== undefined) continue;
		if (chain.length > best.length) best = chain;
	}
	return best;
}

export function compressBreadcrumbPath(
	path: ActivityBreadcrumbDescriptor[],
	compact: boolean,
): ActivityBreadcrumbSegment[] {
	if (!compact || path.length <= 2) return path;
	const first = path[0];
	const last = path[path.length - 1];
	if (!first || !last) return path;
	return [first, { id: "ellipsis", kind: "ellipsis" }, last];
}

function SegmentIcon({ kind }: { kind: ActivityBreadcrumbKind }) {
	const Icon = kind === "activity" ? Layers : kind === "thinking" ? Brain : Tools;
	return <Icon aria-hidden className="size-12 shrink-0 text-primary" />;
}

export function ActivityBreadcrumbBar({
	segments,
	measureClassName,
	onJump,
	onToggle,
}: {
	segments: ActivityBreadcrumbSegment[];
	measureClassName: string;
	onJump: (id: string) => void;
	onToggle: (id: string) => void;
}) {
	return (
		<nav
			aria-label="Current chat activity path"
			data-testid="activity-breadcrumb-trail"
			className="pointer-events-auto border-border-default border-b bg-container-header-bg shadow-[var(--shadow-md)]"
		>
			<div
				className={`${measureClassName} flex h-[34px] items-center overflow-hidden px-12 tr-text-metadata`}
			>
				{segments.map((segment, index) => (
					<div key={segment.id} className="flex min-w-0 items-center">
						{index > 0 ? (
							<ChevronRight aria-hidden className="size-14 shrink-0 text-text-disabled" />
						) : null}
						{segment.kind === "ellipsis" ? (
							<span data-testid="activity-breadcrumb-ellipsis" className="px-4 text-text-muted">
								…
							</span>
						) : (
							<div
								data-testid="activity-breadcrumb-segment"
								data-kind={segment.kind}
								className="flex min-w-0 items-center rounded-[var(--radius-sm)] hover:bg-control-bg-hovered"
							>
								<button
									type="button"
									aria-label={`${segment.expanded ? "Collapse" : "Expand"} ${segment.label}`}
									onClick={() => onToggle(segment.id)}
									className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
								>
									<ChevronRight
										aria-hidden
										className={`size-14 transition-transform ${segment.expanded ? "rotate-90" : ""}`}
									/>
								</button>
								<button
									type="button"
									aria-label={`Jump to ${segment.label}`}
									title={segment.meta ? `${segment.label} · ${segment.meta}` : segment.label}
									onClick={() => onJump(segment.id)}
									className="flex min-w-0 items-center gap-4 rounded-[var(--radius-sm)] py-2 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
								>
									<SegmentIcon kind={segment.kind} />
									<span className="shrink-0 text-text-default">{segment.label}</span>
									{segment.meta ? (
										<span className="min-w-0 truncate text-text-muted">{segment.meta}</span>
									) : null}
								</button>
							</div>
						)}
					</div>
				))}
			</div>
		</nav>
	);
}

const ACTIVITY_NODE_SELECTOR = "[data-activity-node-id]";

function readBreadcrumbGeometry(scroller: HTMLElement): ActivityBreadcrumbGeometry[] {
	return Array.from(scroller.querySelectorAll<HTMLElement>(ACTIVITY_NODE_SELECTOR)).map(
		(element) => {
			const rect = element.getBoundingClientRect();
			return {
				id: element.dataset.activityNodeId ?? "",
				...(element.dataset.activityParentId ? { parentId: element.dataset.activityParentId } : {}),
				kind: (element.dataset.activityNodeKind ?? "tool") as ActivityBreadcrumbKind,
				label: element.dataset.activityNodeLabel ?? "",
				meta: element.dataset.activityNodeMeta ?? "",
				expanded: element.dataset.expanded === "true",
				top: rect.top,
				bottom: rect.bottom,
			};
		},
	);
}

function sameBreadcrumbPath(
	left: ActivityBreadcrumbDescriptor[],
	right: ActivityBreadcrumbDescriptor[],
): boolean {
	return (
		left.length === right.length &&
		left.every((segment, index) => {
			const other = right[index];
			return (
				other !== undefined &&
				segment.id === other.id &&
				segment.expanded === other.expanded &&
				segment.label === other.label &&
				segment.meta === other.meta
			);
		})
	);
}

function originalActivityNode(scroller: HTMLElement, id: string): HTMLElement | undefined {
	return Array.from(scroller.querySelectorAll<HTMLElement>(ACTIVITY_NODE_SELECTOR)).find(
		(element) => element.dataset.activityNodeId === id,
	);
}

function originalActivityToggle(node: HTMLElement): HTMLButtonElement | undefined {
	return node.querySelector<HTMLButtonElement>(":scope > [data-activity-node-toggle]") ?? undefined;
}

export function ActivityBreadcrumbTrail({
	scroller,
	measureClassName,
}: {
	scroller: HTMLElement | null;
	measureClassName: string;
}) {
	const [path, setPath] = useState<ActivityBreadcrumbDescriptor[]>([]);
	const [compact, setCompact] = useState(false);

	const refresh = useCallback(() => {
		if (!scroller) return;
		const boundary = scroller.getBoundingClientRect().top + ACTIVITY_BREADCRUMB_HEIGHT;
		const next = deriveActiveBreadcrumbPath(readBreadcrumbGeometry(scroller), boundary);
		setPath((current) => (sameBreadcrumbPath(current, next) ? current : next));
		setCompact(isCompactBreadcrumbWidth(scroller.clientWidth));
	}, [scroller]);

	useEffect(() => {
		if (!scroller) {
			setPath([]);
			return;
		}
		const view = scroller.ownerDocument.defaultView;
		if (!view) return;
		let frame = 0;
		const schedule = () => {
			view.cancelAnimationFrame(frame);
			frame = view.requestAnimationFrame(refresh);
		};
		const mutation = new MutationObserver(schedule);
		mutation.observe(scroller, { attributes: true, childList: true, subtree: true });
		const resize = new ResizeObserver(schedule);
		resize.observe(scroller);
		scroller.addEventListener("scroll", schedule, { passive: true });
		schedule();
		return () => {
			view.cancelAnimationFrame(frame);
			mutation.disconnect();
			resize.disconnect();
			scroller.removeEventListener("scroll", schedule);
		};
	}, [refresh, scroller]);

	const jump = useCallback(
		(id: string) => {
			if (!scroller) return;
			const node = originalActivityNode(scroller, id);
			const toggle = node ? originalActivityToggle(node) : undefined;
			if (!node || !toggle) return;
			const view = scroller.ownerDocument.defaultView;
			const top = activityBreadcrumbJumpTop(
				scroller.scrollTop,
				scroller.getBoundingClientRect().top,
				node.getBoundingClientRect().top,
			);
			scroller.scrollTo({
				top,
				behavior: view?.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
			});
			toggle.focus({ preventScroll: true });
		},
		[scroller],
	);

	const toggle = useCallback(
		(id: string) => {
			if (!scroller) return;
			const node = originalActivityNode(scroller, id);
			const original = node ? originalActivityToggle(node) : undefined;
			if (!original) return;
			original.click();
			original.focus({ preventScroll: true });
		},
		[scroller],
	);

	if (!scroller || path.length === 0) return null;
	return (
		<div className="pointer-events-none absolute inset-x-0 top-0 z-20">
			<ActivityBreadcrumbBar
				segments={compressBreadcrumbPath(path, compact)}
				measureClassName={measureClassName}
				onJump={jump}
				onToggle={toggle}
			/>
		</div>
	);
}
