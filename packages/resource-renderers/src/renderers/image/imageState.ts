export const MIN_IMAGE_ZOOM = 0.1;
export const MAX_IMAGE_ZOOM = 8;

export type ImageDiffMode = "2-up" | "swipe" | "onion" | "difference";

const IMAGE_DIFF_MODES: readonly ImageDiffMode[] = ["2-up", "swipe", "onion", "difference"];

export function clampImageZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, zoom));
}

export function nextWheelZoom(zoom: number, deltaY: number): number {
	return clampImageZoom(zoom * Math.exp(-deltaY * 0.0015));
}

export function imageSourceUrl(url: string, hash: string): string {
	const path = url.split(/[?#]/, 1)[0] ?? "";
	if (!/(?:^|\/)files(?:\/|$)/.test(path)) return url;
	const fragmentIndex = url.indexOf("#");
	const fragment = fragmentIndex >= 0 ? url.slice(fragmentIndex) : "";
	const base = fragmentIndex >= 0 ? url.slice(0, fragmentIndex) : url;
	return `${base}${base.includes("?") ? "&" : "?"}h=${encodeURIComponent(hash)}${fragment}`;
}

export function formatByteLength(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "Unknown size";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function imageViewState(state: unknown): { mode: "fit" | "zoom"; zoom: number } {
	if (typeof state !== "object" || state === null) return { mode: "fit", zoom: 1 };
	const mode = Reflect.get(state, "mode") === "zoom" ? "zoom" : "fit";
	const rawZoom = Reflect.get(state, "zoom");
	return {
		mode,
		zoom: clampImageZoom(typeof rawZoom === "number" ? rawZoom : 1),
	};
}

export function imageDiffViewState(state: unknown): ImageDiffMode {
	if (typeof state !== "object" || state === null) return "2-up";
	const mode = Reflect.get(state, "mode");
	return IMAGE_DIFF_MODES.find((candidate) => candidate === mode) ?? "2-up";
}
