export type PageZoomAction = "in" | "out" | "reset";

type PageZoomShortcutEvent = Readonly<
	Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">
> &
	Pick<KeyboardEvent, "preventDefault" | "stopImmediatePropagation">;

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;
const PAGE_ZOOM_FACTORS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_PAGE_ZOOM_INDEX = PAGE_ZOOM_FACTORS.indexOf(1);

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
	const action = pageZoomActionForShortcut(event, platform);
	if (!action) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	request(action);
}

function pageZoomFactor(index: number): number {
	const factor = PAGE_ZOOM_FACTORS[index];
	if (factor === undefined) throw new RangeError("Invalid page zoom index");
	return factor;
}

export function createPageZoomController(): (action: PageZoomAction) => number {
	let index = DEFAULT_PAGE_ZOOM_INDEX;
	return (action) => {
		if (action === "reset") index = DEFAULT_PAGE_ZOOM_INDEX;
		else if (action === "in") index = Math.min(index + 1, PAGE_ZOOM_FACTORS.length - 1);
		else index = Math.max(index - 1, 0);
		return pageZoomFactor(index);
	};
}
