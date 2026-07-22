import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Side = "top" | "right" | "bottom" | "left";

/**
 * Wrap a single control in the app's shared tooltip primitive (`components/ui/tooltip`). The tooltip
 * shows on hover (after the provider's delay) and on keyboard focus, and hides on leave/blur. `side`
 * is the preferred open direction — Radix flips it on collision so it never clips a panel edge.
 * `children` must be a single element that forwards a ref (a native button/span, etc.).
 */
export function Tip({
	label,
	side = "top",
	children,
}: {
	label: ReactNode;
	side?: Side;
	children: ReactElement;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side}>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Measure whether a text element is overflow-truncated (`scrollWidth > clientWidth`). Callers show a
 * full-text tooltip **only when the label is actually clipped**, so short labels stay tooltip-free.
 * Re-measures after every render (catches label content changes — `setTruncated` no-ops when unchanged)
 * and on element resize (layout changes without a re-render).
 */
export function useIsTruncated<T extends HTMLElement = HTMLElement>() {
	const ref = useRef<T>(null);
	const [truncated, setTruncated] = useState(false);
	// Re-measure after every render — no dep array — so a changed label is re-evaluated; `setTruncated`
	// bails when the value is unchanged, so this can't loop.
	useLayoutEffect(() => {
		const el = ref.current;
		if (el) setTruncated(el.scrollWidth > el.clientWidth + 1);
	});
	// And on element resize (a layout change with no re-render).
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			setTruncated(el.scrollWidth > el.clientWidth + 1);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return { ref, truncated };
}
