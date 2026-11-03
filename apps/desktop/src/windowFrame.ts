import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const WINDOW_FRAME_VERSION = 1;
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;
const MAX_WINDOW_EXTENT = 20000;
const MIN_VISIBLE_EDGE = 96;
const SAVE_DEBOUNCE_MS = 400;

export type WindowFrame = Readonly<{ x: number; y: number; width: number; height: number }>;
export type DisplayBounds = Readonly<{ x: number; y: number; width: number; height: number }>;

interface WindowFrameDocument {
	version: 1;
	frame: WindowFrame;
}

interface FrameSink {
	readonly getFrame: () => WindowFrame;
	readonly isFullScreen: () => boolean;
	readonly on: (name: "move" | "resize" | "will-close", listener: () => void) => void;
}

function isExtent(value: unknown, min: number): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= MAX_WINDOW_EXTENT
	);
}

function isOffset(value: unknown): value is number {
	return (
		typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_WINDOW_EXTENT
	);
}

export function readWindowFrame(value: unknown): WindowFrame | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const x = Reflect.get(value, "x");
	const y = Reflect.get(value, "y");
	const width = Reflect.get(value, "width");
	const height = Reflect.get(value, "height");
	if (!isOffset(x) || !isOffset(y) || !isExtent(width, MIN_WINDOW_WIDTH)) return null;
	if (!isExtent(height, MIN_WINDOW_HEIGHT)) return null;
	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height),
	};
}

function usableArea(area: DisplayBounds): boolean {
	return area.width > 0 && area.height > 0;
}

function sizedToArea(
	width: number,
	height: number,
	area: DisplayBounds,
): { width: number; height: number } {
	return {
		width: Math.max(MIN_WINDOW_WIDTH, Math.min(width, area.width)),
		height: Math.max(MIN_WINDOW_HEIGHT, Math.min(height, area.height)),
	};
}

export function centredWindowFrame(
	width: number,
	height: number,
	area: DisplayBounds,
): WindowFrame {
	const size = sizedToArea(width, height, area);
	return {
		x: Math.round(area.x + (area.width - size.width) / 2),
		y: Math.round(area.y + (area.height - size.height) / 2),
		...size,
	};
}

function overlap(frame: WindowFrame, area: DisplayBounds): { width: number; height: number } {
	return {
		width: Math.min(frame.x + frame.width, area.x + area.width) - Math.max(frame.x, area.x),
		height: Math.min(frame.y + frame.height, area.y + area.height) - Math.max(frame.y, area.y),
	};
}

function reachable(frame: WindowFrame, area: DisplayBounds): boolean {
	const shared = overlap(frame, area);
	return (
		shared.width >= Math.min(MIN_VISIBLE_EDGE, frame.width) &&
		shared.height >= Math.min(MIN_VISIBLE_EDGE, frame.height)
	);
}

function distanceToCentre(frame: WindowFrame, area: DisplayBounds): number {
	const dx = frame.x + frame.width / 2 - (area.x + area.width / 2);
	const dy = frame.y + frame.height / 2 - (area.y + area.height / 2);
	return dx * dx + dy * dy;
}

function placedIn(
	frame: WindowFrame,
	area: DisplayBounds,
	size: { width: number; height: number },
): WindowFrame {
	return {
		x: Math.min(Math.max(frame.x, area.x), area.x + area.width - size.width),
		y: Math.min(Math.max(frame.y, area.y), area.y + area.height - size.height),
		...size,
	};
}

export function visibleWindowFrame(
	frame: WindowFrame,
	areas: readonly DisplayBounds[],
): WindowFrame {
	const usable = areas.filter(usableArea);
	if (usable.length === 0) return frame;
	const host = usable.find((area) => reachable(frame, area));
	if (host) {
		if (frame.width <= host.width && frame.height <= host.height) return frame;
		return placedIn(frame, host, sizedToArea(frame.width, frame.height, host));
	}
	const nearest = usable.reduce((best, area) =>
		distanceToCentre(frame, area) < distanceToCentre(frame, best) ? area : best,
	);
	return placedIn(frame, nearest, sizedToArea(frame.width, frame.height, nearest));
}

export function initialWindowFrame(
	saved: WindowFrame | null,
	areas: readonly DisplayBounds[],
): WindowFrame {
	if (saved) return visibleWindowFrame(saved, areas);
	const primary = areas.find(usableArea);
	return primary
		? centredWindowFrame(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT, primary)
		: { x: 0, y: 0, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT };
}

export class WindowFrameStore {
	readonly #path: string;

	constructor(path: string) {
		this.#path = path;
	}

	read(): WindowFrame | null {
		try {
			if (!existsSync(this.#path)) return null;
			const value: unknown = JSON.parse(readFileSync(this.#path, "utf8"));
			if (typeof value !== "object" || value === null) return null;
			if (Reflect.get(value, "version") !== WINDOW_FRAME_VERSION) return null;
			return readWindowFrame(Reflect.get(value, "frame"));
		} catch {
			return null;
		}
	}

	write(frame: unknown): boolean {
		const next = readWindowFrame(frame);
		if (!next) return false;
		const document: WindowFrameDocument = { version: WINDOW_FRAME_VERSION, frame: next };
		try {
			mkdirSync(dirname(this.#path), { recursive: true });
			writeFileSync(this.#path, `${JSON.stringify(document, null, "\t")}\n`);
			return true;
		} catch (error) {
			console.error("[desktop] could not save the window frame", error);
			return false;
		}
	}
}

export function installWindowFramePersistence(
	window: FrameSink,
	store: WindowFrameStore,
	debounceMs: number = SAVE_DEBOUNCE_MS,
): void {
	let pending: ReturnType<typeof setTimeout> | null = null;
	const save = () => {
		if (pending) {
			clearTimeout(pending);
			pending = null;
		}
		if (window.isFullScreen()) return;
		store.write(window.getFrame());
	};
	const schedule = () => {
		if (pending) clearTimeout(pending);
		pending = setTimeout(save, debounceMs);
	};
	window.on("move", schedule);
	window.on("resize", schedule);
	window.on("will-close", save);
}
