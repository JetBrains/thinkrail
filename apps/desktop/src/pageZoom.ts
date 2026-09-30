export type PageZoomAction = "in" | "out" | "reset";

type PageZoomShortcutEvent = Readonly<
	Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey">
> &
	Pick<KeyboardEvent, "preventDefault">;

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;
const PAGE_ZOOM_FACTORS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
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

export function nextPageZoom(current: number, action: PageZoomAction): number {
	if (action === "reset") return 1;
	const next =
		action === "in"
			? PAGE_ZOOM_FACTORS.find((factor) => factor > current + PAGE_ZOOM_TOLERANCE)
			: PAGE_ZOOM_FACTORS.findLast((factor) => factor < current - PAGE_ZOOM_TOLERANCE);
	return next ?? current;
}
