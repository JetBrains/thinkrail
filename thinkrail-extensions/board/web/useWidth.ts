import { useEffect, useState } from "react";

/** An element's measured content width (a `ResizeObserver`), `initial` until measured (a server render's). */
export function useWidth(initial: number): {
	width: number;
	attach: (node: HTMLElement | null) => void;
} {
	const [node, setNode] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(initial);
	useEffect(() => {
		if (!node) return;
		const observer = new ResizeObserver(([entry]) =>
			setWidth(Math.floor(entry?.contentRect.width ?? 0)),
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);
	return { width, attach: setNode };
}
