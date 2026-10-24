import { type ReactNode, type RefCallback, useCallback, useRef } from "react";

const SCROLL_TOP = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

function mirrorScroll(
	scroller: HTMLElement,
	sizer: HTMLElement,
	viewport: HTMLElement,
	content: HTMLElement,
): () => void {
	const sync = () => {
		content.style.transform = `translateY(${-scroller.scrollTop}px)`;
	};
	const fit = () => {
		sizer.style.height = `${content.offsetHeight}px`;
		viewport.style.height = `${scroller.clientHeight}px`;
		sync();
	};
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
	fit();
	return () => {
		resize.disconnect();
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
}: {
	attach: RefCallback<HTMLDivElement>;
	testId: string;
	className: string;
	children: ReactNode;
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
			const release = mirrorScroll(node, sizer, viewport, content);
			attach(node);
			return () => {
				attach(null);
				release();
			};
		},
		[attach],
	);
	return (
		<div ref={attachScroller} data-testid={testId} className={className}>
			<div ref={sizerRef}>
				<div ref={viewportRef} className="sticky top-0 overflow-clip">
					<div ref={contentRef} className="flex flex-col will-change-transform">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
}
