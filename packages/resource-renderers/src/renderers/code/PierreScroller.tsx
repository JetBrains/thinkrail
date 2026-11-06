import { type ReactNode, type RefCallback, type RefObject, useCallback, useRef } from "react";

const SCROLL_TOP = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

function mirrorScroll(
	scroller: HTMLElement,
	sizer: HTMLElement,
	viewport: HTMLElement,
	content: HTMLElement,
	horizontalBar: HTMLElement | null,
): () => void {
	const layoutAncestors: HTMLElement[] = [];
	const ancestors: HTMLElement[] = [];
	for (let parent = scroller.parentElement; parent; parent = parent.parentElement) {
		layoutAncestors.push(parent);
		if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) ancestors.push(parent);
	}
	const placeBar = () => {
		if (!horizontalBar) return;
		const bounds = viewport.getBoundingClientRect();
		const bottom = Math.min(
			bounds.bottom,
			window.innerHeight,
			...ancestors.map(
				(parent) => parent.getBoundingClientRect().top + parent.clientTop + parent.clientHeight,
			),
		);
		horizontalBar.style.bottom = `${Math.max(0, bounds.bottom - bottom)}px`;
	};
	const sync = () => {
		content.style.transform = `translateY(${-scroller.scrollTop}px)`;
		placeBar();
	};
	const fit = () => {
		sizer.style.height = `${content.offsetHeight + (horizontalBar?.offsetHeight ?? 0)}px`;
		viewport.style.height = `${scroller.clientHeight}px`;
		sync();
	};
	for (const parent of ancestors) parent.addEventListener("scroll", placeBar, { passive: true });
	window.addEventListener("resize", placeBar);
	const nativeScrollTo = scroller.scrollTo;
	Object.defineProperty(scroller, "scrollTo", {
		configurable: true,
		value: (...args: unknown[]) => {
			Reflect.apply(nativeScrollTo, scroller, args);
			sync();
		},
	});
	if (SCROLL_TOP?.get && SCROLL_TOP.set) {
		const { get, set } = SCROLL_TOP;
		Object.defineProperty(scroller, "scrollTop", {
			configurable: true,
			get: () => get.call(scroller),
			set: (top: number) => {
				set.call(scroller, top);
				sync();
			},
		});
	}
	scroller.addEventListener("scroll", sync, { passive: true });
	const resize = new ResizeObserver(fit);
	resize.observe(scroller);
	resize.observe(content);
	const placementResize = horizontalBar ? new ResizeObserver(placeBar) : null;
	for (const parent of layoutAncestors) placementResize?.observe(parent);
	if (horizontalBar) resize.observe(horizontalBar);
	fit();
	return () => {
		resize.disconnect();
		placementResize?.disconnect();
		for (const parent of ancestors) parent.removeEventListener("scroll", placeBar);
		window.removeEventListener("resize", placeBar);
		horizontalBar?.style.removeProperty("bottom");
		scroller.removeEventListener("scroll", sync);
		Reflect.deleteProperty(scroller, "scrollTo");
		Reflect.deleteProperty(scroller, "scrollTop");
		sizer.style.removeProperty("height");
		viewport.style.removeProperty("height");
		content.style.removeProperty("transform");
	};
}

export function PierreScroller({
	attach,
	testId,
	className,
	children,
	horizontalBarRef,
}: {
	attach: RefCallback<HTMLDivElement>;
	testId: string;
	className: string;
	children: ReactNode;
	horizontalBarRef?: RefObject<HTMLDivElement | null>;
}) {
	const sizerRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const attachScroller = useCallback(
		(node: HTMLDivElement | null) => {
			const sizer = sizerRef.current;
			const viewport = viewportRef.current;
			const content = contentRef.current;
			if (!node || !sizer || !viewport || !content) return;
			const release = mirrorScroll(
				node,
				sizer,
				viewport,
				content,
				horizontalBarRef?.current ?? null,
			);
			attach(node);
			return () => {
				attach(null);
				release();
			};
		},
		[attach, horizontalBarRef],
	);
	return (
		<div ref={attachScroller} data-testid={testId} className={`pierre-scroll-owner ${className}`}>
			<div ref={sizerRef}>
				<div ref={viewportRef} className="sticky top-0 overflow-clip">
					<div ref={contentRef} className="flex flex-col will-change-transform">
						{children}
					</div>
					{horizontalBarRef ? (
						<div
							ref={horizontalBarRef}
							hidden
							data-testid="diff-horizontal-scrollbar"
							className="pierre-horizontal-scrollbar absolute inset-x-0 bottom-0 h-6 overflow-x-scroll overflow-y-hidden bg-container-content-bg"
						>
							<div className="h-px" />
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
