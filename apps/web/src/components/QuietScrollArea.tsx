import { type ComponentPropsWithoutRef, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib";

type QuietScrollAxis = "vertical" | "both";
type QuietScrollSurface = "sidebar" | "terminal";
type ScrollEdge = "top" | "right" | "bottom" | "left";

interface ScrollEdges {
	top: boolean;
	right: boolean;
	bottom: boolean;
	left: boolean;
}

const NO_EDGES: ScrollEdges = {
	top: false,
	right: false,
	bottom: false,
	left: false,
};

const CURTAIN_CLASSES: Record<QuietScrollSurface, Record<ScrollEdge, string>> = {
	sidebar: {
		top: "inset-x-0 top-0 h-16 bg-[linear-gradient(to_bottom,var(--color-container-sidebar-bg),transparent)]",
		right:
			"inset-y-0 right-0 w-16 bg-[linear-gradient(to_left,var(--color-container-sidebar-bg),transparent)]",
		bottom:
			"inset-x-0 bottom-0 h-16 bg-[linear-gradient(to_top,var(--color-container-sidebar-bg),transparent)]",
		left: "inset-y-0 left-0 w-16 bg-[linear-gradient(to_right,var(--color-container-sidebar-bg),transparent)]",
	},
	terminal: {
		top: "inset-x-0 top-0 h-16 bg-[linear-gradient(to_bottom,var(--color-container-terminal-bg),transparent)]",
		right:
			"inset-y-0 right-0 w-16 bg-[linear-gradient(to_left,var(--color-container-terminal-bg),transparent)]",
		bottom:
			"inset-x-0 bottom-0 h-16 bg-[linear-gradient(to_top,var(--color-container-terminal-bg),transparent)]",
		left: "inset-y-0 left-0 w-16 bg-[linear-gradient(to_right,var(--color-container-terminal-bg),transparent)]",
	},
};

const SCROLL_INTENT_GRACE_MS = 700;
const EDGE_EPSILON_PX = 1;

function sameEdges(left: ScrollEdges, right: ScrollEdges): boolean {
	return (
		left.top === right.top &&
		left.right === right.right &&
		left.bottom === right.bottom &&
		left.left === right.left
	);
}

function readEdges(viewport: HTMLElement, axis: QuietScrollAxis): ScrollEdges {
	const maximumTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	const maximumLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
	return {
		top: viewport.scrollTop > EDGE_EPSILON_PX,
		right: axis === "both" && viewport.scrollLeft < maximumLeft - EDGE_EPSILON_PX,
		bottom: viewport.scrollTop < maximumTop - EDGE_EPSILON_PX,
		left: axis === "both" && viewport.scrollLeft > EDGE_EPSILON_PX,
	};
}

function useScrollEdges(
	viewport: HTMLElement | null,
	intentRoot: HTMLElement | null,
	axis: QuietScrollAxis,
): ScrollEdges {
	const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

	useEffect(() => {
		if (!viewport || !intentRoot) {
			setEdges((current) => (sameEdges(current, NO_EDGES) ? current : NO_EDGES));
			return;
		}

		const hadViewportClass = viewport.classList.contains("quiet-scroll-viewport");
		viewport.classList.add("quiet-scroll-viewport");
		let pointerInside = intentRoot.matches(":hover");
		let focusInside = intentRoot.contains(document.activeElement);
		let scrolling = false;
		let scrollTimer: ReturnType<typeof setTimeout> | undefined;

		const updateEdges = () => {
			const next = readEdges(viewport, axis);
			setEdges((current) => (sameEdges(current, next) ? current : next));
		};
		const updateIntent = () => {
			viewport.toggleAttribute(
				"data-quiet-scroll-intent",
				pointerInside || focusInside || scrolling,
			);
		};
		const onPointerEnter = (event: PointerEvent) => {
			pointerInside = event.pointerType !== "touch";
			updateIntent();
		};
		const onPointerLeave = () => {
			pointerInside = false;
			updateIntent();
		};
		const onFocusIn = () => {
			focusInside = true;
			updateIntent();
		};
		const onFocusOut = (event: FocusEvent) => {
			focusInside = event.relatedTarget instanceof Node && intentRoot.contains(event.relatedTarget);
			updateIntent();
		};
		const onScroll = () => {
			updateEdges();
			scrolling = true;
			updateIntent();
			clearTimeout(scrollTimer);
			scrollTimer = setTimeout(() => {
				scrolling = false;
				updateIntent();
			}, SCROLL_INTENT_GRACE_MS);
		};

		updateEdges();
		updateIntent();
		const frame = requestAnimationFrame(updateEdges);
		viewport.addEventListener("scroll", onScroll, { passive: true });
		intentRoot.addEventListener("pointerenter", onPointerEnter);
		intentRoot.addEventListener("pointerleave", onPointerLeave);
		intentRoot.addEventListener("focusin", onFocusIn);
		intentRoot.addEventListener("focusout", onFocusOut);

		const resize = new ResizeObserver(updateEdges);
		const observeSizes = () => {
			resize.disconnect();
			resize.observe(viewport);
			for (const child of viewport.children) resize.observe(child);
		};
		observeSizes();
		const mutations = new MutationObserver(() => {
			observeSizes();
			updateEdges();
		});
		mutations.observe(viewport, { childList: true, subtree: true });

		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(scrollTimer);
			viewport.removeEventListener("scroll", onScroll);
			intentRoot.removeEventListener("pointerenter", onPointerEnter);
			intentRoot.removeEventListener("pointerleave", onPointerLeave);
			intentRoot.removeEventListener("focusin", onFocusIn);
			intentRoot.removeEventListener("focusout", onFocusOut);
			resize.disconnect();
			mutations.disconnect();
			viewport.removeAttribute("data-quiet-scroll-intent");
			if (!hadViewportClass) viewport.classList.remove("quiet-scroll-viewport");
		};
	}, [axis, intentRoot, viewport]);

	return edges;
}

function QuietScrollCurtains({
	viewport,
	intentRoot,
	axis,
	surface,
}: {
	viewport: HTMLElement | null;
	intentRoot: HTMLElement | null;
	axis: QuietScrollAxis;
	surface: QuietScrollSurface;
}) {
	const edges = useScrollEdges(viewport, intentRoot, axis);
	return (
		<div
			aria-hidden="true"
			data-testid="quiet-scroll-cues"
			data-scroll-top={edges.top || undefined}
			data-scroll-right={edges.right || undefined}
			data-scroll-bottom={edges.bottom || undefined}
			data-scroll-left={edges.left || undefined}
			className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
		>
			{(["top", "right", "bottom", "left"] as const).map((edge) => (
				<span
					key={edge}
					data-testid={`quiet-scroll-${edge}`}
					data-visible={edges[edge] || undefined}
					className={cn(
						"quiet-scroll-curtain pointer-events-none absolute",
						CURTAIN_CLASSES[surface][edge],
						edges[edge] ? "opacity-100" : "opacity-0",
					)}
				/>
			))}
		</div>
	);
}

interface QuietScrollAreaProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children: ReactNode;
	viewportClassName?: string | undefined;
	viewportTestId?: string | undefined;
	surface?: QuietScrollSurface | undefined;
	axis?: QuietScrollAxis | undefined;
}

export function QuietScrollArea({
	children,
	className,
	viewportClassName,
	viewportTestId,
	surface = "sidebar",
	axis = "vertical",
	...props
}: QuietScrollAreaProps) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	return (
		<div
			ref={setRoot}
			data-quiet-scroll-surface={surface}
			className={cn("quiet-scroll-host relative min-h-0 min-w-0 overflow-hidden", className)}
			{...props}
		>
			<div
				ref={setViewport}
				data-testid={viewportTestId}
				className={cn("quiet-scroll-viewport size-full overflow-auto", viewportClassName)}
			>
				{children}
			</div>
			<QuietScrollCurtains viewport={viewport} intentRoot={root} axis={axis} surface={surface} />
		</div>
	);
}

interface QuietScrollFrameProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children: ReactNode;
	viewportSelector: string;
	surface?: QuietScrollSurface | undefined;
	axis?: QuietScrollAxis | undefined;
}

export function QuietScrollFrame({
	children,
	className,
	viewportSelector,
	surface = "sidebar",
	axis = "vertical",
	...props
}: QuietScrollFrameProps) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [viewport, setViewport] = useState<HTMLElement | null>(null);

	useEffect(() => {
		if (!root) return;
		const findViewport = () => {
			setViewport((current) => {
				const next = root.querySelector<HTMLElement>(viewportSelector);
				return current === next ? current : next;
			});
		};
		findViewport();
		const mutations = new MutationObserver(findViewport);
		mutations.observe(root, { childList: true, subtree: true });
		return () => mutations.disconnect();
	}, [root, viewportSelector]);

	return (
		<div
			ref={setRoot}
			data-quiet-scroll-surface={surface}
			className={cn("quiet-scroll-host relative min-h-0 min-w-0 overflow-hidden", className)}
			{...props}
		>
			{children}
			<QuietScrollCurtains viewport={viewport} intentRoot={root} axis={axis} surface={surface} />
		</div>
	);
}
