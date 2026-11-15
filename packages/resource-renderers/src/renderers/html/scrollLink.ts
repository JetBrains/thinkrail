export interface ScrollLink {
	attach(view: Window): () => void;
}

interface Offset {
	top: number;
	left: number;
}

function scroller(view: Window): Element | null {
	try {
		return view.document.scrollingElement ?? view.document.documentElement;
	} catch {
		return null;
	}
}

function offsetOf(element: Element): Offset {
	return { top: element.scrollTop, left: element.scrollLeft };
}

export function createScrollLink(): ScrollLink {
	let offset: Offset = { top: 0, left: 0 };
	const members = new Set<Window>();
	const echoes = new Map<Window, Offset>();

	const place = (view: Window) => {
		const element = scroller(view);
		if (!element) return;
		element.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });
		echoes.set(view, offsetOf(element));
	};

	return {
		attach(view) {
			members.add(view);
			place(view);
			const onScroll = () => {
				const element = scroller(view);
				if (!element) return;
				const now = offsetOf(element);
				const echo = echoes.get(view);
				echoes.delete(view);
				if (echo && echo.top === now.top && echo.left === now.left) return;
				offset = now;
				for (const other of members) if (other !== view) place(other);
			};
			view.addEventListener("scroll", onScroll);
			return () => {
				view.removeEventListener("scroll", onScroll);
				members.delete(view);
				echoes.delete(view);
			};
		},
	};
}
