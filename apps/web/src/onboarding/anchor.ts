import { useEffect, useState } from "react";

export function useTargetRect(selector: string | null): DOMRect | null {
	const [rect, setRect] = useState<DOMRect | null>(null);
	useEffect(() => {
		if (!selector) {
			setRect(null);
			return;
		}
		let frame = 0;
		const measure = () => {
			const element = document.querySelector(selector);
			setRect(element ? element.getBoundingClientRect() : null);
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [selector]);
	return rect;
}
