import { SCROLL_BRIDGE_SOURCE } from "./htmlDocument";

export interface ScrollOffset {
	top: number;
	left: number;
}

export interface ScrollEndpoint {
	read(): ScrollOffset | null;
	write(offset: ScrollOffset): ScrollOffset;
	listen(onScroll: () => void, onApplied: (offset: ScrollOffset) => void): () => void;
}

export interface ScrollLink {
	attach(endpoint: ScrollEndpoint): () => void;
}

export interface ScrollLinkClock {
	requestFrame(callback: () => void): number;
	cancelFrame(handle: number): void;
	every(ms: number, callback: () => void): () => void;
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

function offsetOf(element: Element): ScrollOffset {
	return { top: element.scrollTop, left: element.scrollLeft };
}

function sameOffset(a: ScrollOffset, b: ScrollOffset): boolean {
	return a.top === b.top && a.left === b.left;
}

export function windowScrollEndpoint(view: Window): ScrollEndpoint {
	return {
		read: () => {
			const element = scroller(view);
			return element ? offsetOf(element) : null;
		},
		write: (offset) => {
			const element = scroller(view);
			if (!element) return offset;
			element.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });
			return offsetOf(element);
		},
		listen: (onScroll) => {
			view.addEventListener("scroll", onScroll);
			return () => view.removeEventListener("scroll", onScroll);
		},
	};
}

function bridgeMessage(data: unknown): { kind: "scroll" | "applied"; offset: ScrollOffset } | null {
	if (typeof data !== "object" || data === null) return null;
	const { source, kind, top, left } = data as Record<string, unknown>;
	if (source !== SCROLL_BRIDGE_SOURCE || (kind !== "scroll" && kind !== "applied")) return null;
	if (typeof top !== "number" || typeof left !== "number") return null;
	if (!Number.isFinite(top) || !Number.isFinite(left)) return null;
	return { kind, offset: { top, left } };
}

export function frameLifecycleMessage(data: unknown, token: string): "loaded" | "left" | null {
	if (typeof data !== "object" || data === null) return null;
	const message = data as Record<string, unknown>;
	if (message.source !== SCROLL_BRIDGE_SOURCE || message.token !== token) return null;
	return message.kind === "loaded" || message.kind === "left" ? message.kind : null;
}

export function messageScrollEndpoint(
	frame: Pick<Window, "postMessage">,
	host: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): ScrollEndpoint {
	let reported: ScrollOffset | null = null;
	return {
		read: () => reported,
		write: (offset) => {
			reported = offset;
			frame.postMessage({ source: SCROLL_BRIDGE_SOURCE, kind: "scrollTo", ...offset }, "*");
			return offset;
		},
		listen: (onScroll, onApplied) => {
			const onMessage = (event: MessageEvent) => {
				if (event.source !== frame) return;
				const message = bridgeMessage(event.data);
				if (!message) return;
				reported = message.offset;
				if (message.kind === "applied") onApplied(message.offset);
				else onScroll();
			};
			host.addEventListener("message", onMessage);
			return () => host.removeEventListener("message", onMessage);
		},
	};
}

export function createScrollLink(clock: ScrollLinkClock = browserClock): ScrollLink {
	let offset: ScrollOffset = { top: 0, left: 0 };
	const seen = new Map<ScrollEndpoint, ScrollOffset>();
	let frame = 0;
	let quiet = 0;
	let stopPolling: (() => void) | null = null;

	const place = (endpoint: ScrollEndpoint) => {
		seen.set(endpoint, endpoint.write(offset));
	};

	const sync = (): boolean => {
		for (const [endpoint, last] of seen) {
			const now = endpoint.read();
			if (!now || sameOffset(now, last)) continue;
			seen.set(endpoint, now);
			offset = now;
			for (const other of seen.keys()) if (other !== endpoint) place(other);
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
		attach(endpoint) {
			place(endpoint);
			stopPolling ??= clock.every(POLL_MS, follow);
			const stopListening = endpoint.listen(follow, (applied) => {
				if (seen.has(endpoint)) seen.set(endpoint, applied);
			});
			return () => {
				stopListening();
				seen.delete(endpoint);
				if (seen.size > 0) return;
				stopPolling?.();
				stopPolling = null;
				if (frame) clock.cancelFrame(frame);
				frame = 0;
			};
		},
	};
}
