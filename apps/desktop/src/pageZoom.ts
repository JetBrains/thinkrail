export type PageZoomAction = "in" | "out" | "reset";

export type PageZoomGesture =
	| { phase: "start" }
	| { phase: "change"; scale: number }
	| { phase: "end" };

type PageZoomShortcutEvent = Readonly<
	Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey">
> &
	Pick<KeyboardEvent, "preventDefault">;

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;
const PAGE_ZOOM_MIN = 0.5;
const PAGE_ZOOM_MAX = 2;
const PAGE_ZOOM_FACTORS = [
	PAGE_ZOOM_MIN,
	0.67,
	0.8,
	0.9,
	1,
	1.1,
	1.25,
	1.5,
	1.75,
	PAGE_ZOOM_MAX,
] as const;
const PAGE_ZOOM_TOLERANCE = 0.001;

function pageZoomActionForShortcut(
	event: PageZoomShortcutEvent,
	platform: string,
): PageZoomAction | null {
	const hasPlatformModifier = APPLE_PLATFORM.test(platform)
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
	if (!hasPlatformModifier || event.altKey) return null;
	if (event.key === "+" || event.key === "=") return "in";
	if (event.key === "-") return "out";
	return event.key === "0" ? "reset" : null;
}

export function handlePageZoomShortcut(
	event: PageZoomShortcutEvent,
	platform: string,
	request: (action: PageZoomAction) => void,
): void {
	if (event.defaultPrevented) return;
	const action = pageZoomActionForShortcut(event, platform);
	if (!action) return;
	event.preventDefault();
	request(action);
}

export function installPageZoomGestures(
	target: EventTarget,
	platform: string,
	request: (gesture: PageZoomGesture) => void,
): void {
	if (!APPLE_PLATFORM.test(platform)) return;
	let active = false;
	target.addEventListener(
		"gesturestart",
		(event) => {
			if (event.defaultPrevented) return;
			active = true;
			event.preventDefault();
			request({ phase: "start" });
		},
		{ passive: false },
	);
	target.addEventListener(
		"gesturechange",
		(event) => {
			if (!active || event.defaultPrevented) return;
			const scale: unknown = Reflect.get(event, "scale");
			if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
			event.preventDefault();
			request({ phase: "change", scale });
		},
		{ passive: false },
	);
	target.addEventListener(
		"gestureend",
		(event) => {
			if (!active) return;
			active = false;
			event.preventDefault();
			request({ phase: "end" });
		},
		{ passive: false },
	);
}

export function createPageZoomGestureHandler(port: {
	getPageZoom(): number;
	setPageZoom(zoom: number): void;
}): (gesture: PageZoomGesture) => void {
	let start: number | null = null;
	return (gesture) => {
		if (gesture.phase === "start") {
			start = port.getPageZoom();
			return;
		}
		if (gesture.phase === "end") {
			start = null;
			return;
		}
		if (start !== null) port.setPageZoom(pageZoomForGesture(start, gesture.scale));
	};
}

export function pageZoomForGesture(start: number, scale: number): number {
	if (!Number.isFinite(scale) || scale <= 0) return start;
	return Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, start * scale));
}

export function nextPageZoom(current: number, action: PageZoomAction): number {
	if (action === "reset") return 1;
	const next =
		action === "in"
			? PAGE_ZOOM_FACTORS.find((factor) => factor > current + PAGE_ZOOM_TOLERANCE)
			: PAGE_ZOOM_FACTORS.findLast((factor) => factor < current - PAGE_ZOOM_TOLERANCE);
	return next ?? current;
}
