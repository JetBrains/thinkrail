import type { PanelPlacement } from "@thinkrail/extension-api/web";
import { useEffect, useState } from "react";

/** The width a chat pane is taken to have before its first measure. */
const PANE_WIDTH = 480;

/** A panel's width before its first measure: a chat pane's usual one, else unbounded. */
export function guessedWidth(placement: PanelPlacement | undefined): number {
	return placement === "chatPane" ? PANE_WIDTH : Number.POSITIVE_INFINITY;
}

/** `root`'s width as it resizes (a `ResizeObserver`), `guess` until the first measure. */
export function useWidth(root: HTMLElement | null, guess: number): number {
	const [width, setWidth] = useState(guess);
	useEffect(() => {
		if (!root) return;
		const read = () => {
			if (root.clientWidth > 0) setWidth(root.clientWidth);
		};
		read();
		const observer = new ResizeObserver(read);
		observer.observe(root);
		return () => observer.disconnect();
	}, [root]);
	return width;
}
