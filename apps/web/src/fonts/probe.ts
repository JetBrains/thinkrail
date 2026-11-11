import { quoteFamily } from "./stack";

export interface FontProbe {
	renders: boolean;
	monospace: boolean;
}

export type WeightResponse = "smooth" | "steps" | "fixed";

const PROBE_TEXT = "mmmmmmmmmwwwwwlli10OQ@#";
const FALLBACKS = ["monospace", "serif", "sans-serif"] as const;

const INK_TEXT = "Hamburgefonstiv 0123";
const INK_SIZE = { width: 480, height: 48 } as const;

let context: CanvasRenderingContext2D | null | undefined;
const probes = new Map<string, FontProbe>();
let probedRevision = -1;

function canvas(): CanvasRenderingContext2D | null {
	if (context === undefined) {
		const element = typeof document === "undefined" ? null : document.createElement("canvas");
		if (element) {
			element.width = INK_SIZE.width;
			element.height = INK_SIZE.height;
		}
		context = element?.getContext("2d", { willReadFrequently: true }) ?? null;
	}
	return context;
}

function width(font: string, text = PROBE_TEXT): number {
	const ctx = canvas();
	if (!ctx) return 0;
	ctx.font = `32px ${font}`;
	return ctx.measureText(text).width;
}

function ink(font: string): number {
	const ctx = canvas();
	if (!ctx) return 0;
	ctx.clearRect(0, 0, INK_SIZE.width, INK_SIZE.height);
	ctx.font = font;
	ctx.textBaseline = "middle";
	ctx.fillText(INK_TEXT, 0, INK_SIZE.height / 2);
	const pixels = ctx.getImageData(0, 0, INK_SIZE.width, INK_SIZE.height).data;
	let total = 0;
	for (let index = 3; index < pixels.length; index += 4) total += pixels[index] ?? 0;
	return total;
}

export function classifyWeightResponse(
	lighter: number,
	base: number,
	heavier: number,
): WeightResponse {
	const down = lighter !== base;
	const up = heavier !== base;
	return down && up ? "smooth" : down || up ? "steps" : "fixed";
}

export async function weightResponse(
	family: string,
	weights: readonly [number, number, number],
): Promise<WeightResponse> {
	const quoted = quoteFamily(family);
	await Promise.allSettled(
		weights.map((weight) => document.fonts.load(`${weight} 32px ${quoted}`)),
	);
	const [lighter, base, heavier] = weights.map((weight) =>
		ink(`${weight} 32px ${quoted}, sans-serif`),
	);
	return classifyWeightResponse(lighter ?? 0, base ?? 0, heavier ?? 0);
}

export function probeFont(family: string, facesRevision: number): FontProbe {
	if (facesRevision !== probedRevision) {
		probes.clear();
		probedRevision = facesRevision;
	}
	const known = probes.get(family);
	if (known) return known;
	const quoted = quoteFamily(family);
	const renders = FALLBACKS.some((fallback) => width(`${quoted}, ${fallback}`) !== width(fallback));
	const sample = `${quoted}, sans-serif`;
	const monospace =
		renders && Math.abs(width(sample, "iiiiiiiiii") - width(sample, "MMMMMMMMMM")) < 0.5;
	const probe = { renders, monospace };
	probes.set(family, probe);
	return probe;
}
