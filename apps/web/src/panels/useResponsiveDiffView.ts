import { fontsLoaded, resolveFont, watchFont } from "@thinkrail/ui/fonts";
import { useLayoutEffect, useState } from "react";
import type { DiffTabView } from "../store";

function minimumSplitWidth(): number {
	const probe = document.createElement("span");
	probe.className = "absolute invisible whitespace-pre tr-code-editor";
	probe.setAttribute("aria-hidden", "true");
	probe.textContent = "0".repeat(2 * (40 + 6));
	document.body.append(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width;
}

export function useResponsiveDiffView(explicit: DiffTabView | undefined, mobile: boolean) {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [automatic, setAutomatic] = useState<DiffTabView>("inline");
	useLayoutEffect(() => {
		if (!element || explicit || mobile) return;
		let active = true;
		let minimum = minimumSplitWidth();
		const measure = () => {
			if (!active) return;
			const width = element.getBoundingClientRect().width;
			if (width > 0 && minimum > 0) setAutomatic(width < minimum ? "inline" : "split");
		};
		const updateFont = () => {
			if (!active) return;
			minimum = minimumSplitWidth();
			measure();
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const stopFont = watchFont("tr-code-editor", ["family", "size", "weight"], updateFont);
		void fontsLoaded(resolveFont("tr-code-editor")).then(updateFont);
		return () => {
			active = false;
			observer.disconnect();
			stopFont();
		};
	}, [element, explicit, mobile]);
	return [setElement, mobile ? "inline" : (explicit ?? automatic)] as const;
}
