export interface ScrollLink {
	attach(view: Window): () => void;
}

export interface ScrollLinkClock {
	requestFrame(callback: () => void): number;
	cancelFrame(handle: number): void;
	every(ms: number, callback: () => void): () => void;
}

interface Offset {
	top: number;
	left: number;
}

const POLL_MS = 100;
const SETTLED_FRAMES = 20;

const browserClock: ScrollLinkClock = {
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	every: (ms, callback) => {
		const timer = setInterval(callback, ms);
		return () => clearInterval(timer);
	},
};

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

function sameOffset(a: Offset, b: Offset): boolean {
	return a.top === b.top && a.left === b.left;
}

export function createScrollLink(clock: ScrollLinkClock = browserClock): ScrollLink {
	let offset: Offset = { top: 0, left: 0 };
	const seen = new Map<Window, Offset>();
	let frame = 0;
	let quiet = 0;
	let stopPolling: (() => void) | null = null;

	const place = (view: Window) => {
		const element = scroller(view);
		if (!element) return;
		element.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });
		seen.set(view, offsetOf(element));
	};

	const sync = (): boolean => {
		for (const [view, last] of seen) {
			const element = scroller(view);
			if (!element) continue;
			const now = offsetOf(element);
			if (sameOffset(now, last)) continue;
			seen.set(view, now);
			offset = now;
			for (const other of seen.keys()) if (other !== view) place(other);
			return true;
		}
		return false;
	};

	const tick = () => {
		frame = 0;
		quiet = sync() ? 0 : quiet + 1;
		if (quiet < SETTLED_FRAMES) frame = clock.requestFrame(tick);
	};

	const follow = () => {
		if (!sync()) return;
		quiet = 0;
		if (!frame) frame = clock.requestFrame(tick);
	};

	return {
		attach(view) {
			place(view);
			stopPolling ??= clock.every(POLL_MS, follow);
			view.addEventListener("scroll", follow);
			return () => {
				view.removeEventListener("scroll", follow);
				seen.delete(view);
				if (seen.size > 0) return;
				stopPolling?.();
				stopPolling = null;
				if (frame) clock.cancelFrame(frame);
				frame = 0;
			};
		},
	};
}
