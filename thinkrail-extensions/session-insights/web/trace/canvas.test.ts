import type { Palette } from "./palette";

/** A straight piece of a stroked path, with whether a dash pattern was set. */
export interface StrokedLine {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	dashed: boolean;
}

export interface StrokedRect {
	x: number;
	y: number;
	width: number;
	height: number;
	dashed: boolean;
}

export interface CanvasRecord {
	/** Every context call a draw made: the work it asked of the canvas. */
	calls: number;
	/** `lineTo` calls, counted past `KEEP` too. */
	lineTos: number;
	lines: StrokedLine[];
	rects: StrokedRect[];
	/** `rect` calls: the clip boxes of a path. */
	clips: StrokedRect[];
}

/** Lines and rects kept per list; a draw past it is wrong anyway, and counting stays cheap. */
const KEEP = 50_000;

/**
 * A 2D context that records a draw instead of painting it: its calls, and the lines and rectangles it
 * strokes, so a test counts the work and checks where it lands. A Bézier counts as its chord.
 */
export function recordingContext(): { context: CanvasRenderingContext2D; record: CanvasRecord } {
	const record: CanvasRecord = { calls: 0, lineTos: 0, lines: [], rects: [], clips: [] };
	let dashed = false;
	let path: StrokedLine[] = [];
	let at = { x: 0, y: 0 };
	let start = { x: 0, y: 0 };
	const call = () => {
		record.calls += 1;
	};
	const line = (x: number, y: number) => {
		if (path.length < KEEP) path.push({ x0: at.x, y0: at.y, x1: x, y1: y, dashed });
		at = { x, y };
	};
	const fake = {
		globalAlpha: 1,
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		font: "",
		textBaseline: "alphabetic",
		lineDashOffset: 0,
		save: call,
		restore: call,
		setTransform: call,
		clearRect: call,
		clip: call,
		fill: call,
		fillRect: call,
		fillText: call,
		drawImage: call,
		beginPath() {
			call();
			path = [];
		},
		closePath() {
			call();
			line(start.x, start.y);
		},
		moveTo(x: number, y: number) {
			call();
			at = { x, y };
			start = at;
		},
		lineTo(x: number, y: number) {
			call();
			record.lineTos += 1;
			line(x, y);
		},
		bezierCurveTo(_c0: number, _c1: number, _c2: number, _c3: number, x: number, y: number) {
			call();
			line(x, y);
		},
		rect(x: number, y: number, width: number, height: number) {
			call();
			if (record.clips.length < KEEP) record.clips.push({ x, y, width, height, dashed });
			at = { x, y };
			start = at;
		},
		stroke() {
			call();
			for (const item of path) if (record.lines.length < KEEP) record.lines.push(item);
		},
		strokeRect(x: number, y: number, width: number, height: number) {
			call();
			if (record.rects.length < KEEP) record.rects.push({ x, y, width, height, dashed });
		},
		setLineDash(segments: readonly number[]) {
			call();
			dashed = segments.length > 0;
		},
		measureText(text: string) {
			call();
			return { width: text.length * 6 };
		},
	};
	return { context: fake as unknown as CanvasRenderingContext2D, record };
}

export function fakeCanvas(context: CanvasRenderingContext2D): HTMLCanvasElement {
	return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}

/**
 * Runs `body` with the browser globals an engine draws through — animation frames it flushes by hand
 * and a `document` whose canvases record into `offscreen` — and puts the globals back.
 */
export function withBrowser(
	offscreen: CanvasRenderingContext2D,
	body: (flush: () => void) => void,
): void {
	const frames: FrameRequestCallback[] = [];
	const globals = {
		requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
		cancelAnimationFrame: () => {},
		document: { createElement: () => fakeCanvas(offscreen) },
	};
	const names = Object.keys(globals) as (keyof typeof globals)[];
	const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
	for (const name of names)
		Object.defineProperty(globalThis, name, {
			value: globals[name],
			configurable: true,
			writable: true,
		});
	try {
		body(() => {
			for (const frame of frames.splice(0)) frame(0);
		});
	} finally {
		names.forEach((name, index) => {
			const descriptor = before[index];
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
}

export const PALETTE: Palette = {
	series: {
		"series-1": "#111111",
		"series-2": "#222222",
		"series-3": "#333333",
		"series-4": "#444444",
		"series-5": "#555555",
		"series-6": "#666666",
		"series-7": "#777777",
		"series-8": "#888888",
		primary: "#999999",
	},
	ramp: ["#a1a1a1", "#a2a2a2", "#a3a3a3", "#a4a4a4", "#a5a5a5"],
	canvas: "#ffffff",
	text: "#000000",
	muted: "#b0b0b0",
	subtle: "#c0c0c0",
	grid: "#d0d0d0",
	rule: "#e0e0e0",
	error: "#ff0000",
	warning: "#ffaa00",
	success: "#00aa00",
	selected: "#eeeeff",
	focus: "#0000ff",
};
