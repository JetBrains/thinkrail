/** A label pinned to an x position of a chart (a compaction's or a model switch's rule). */
export interface ChartLabel {
	key: string;
	/** The rule's x, in CSS pixels. */
	x: number;
	/** The texts to try, the fullest first; the last is the shortest form. */
	variants: readonly string[];
}

export interface PlacedLabel {
	key: string;
	text: string;
	/** 0 is the top row. */
	row: number;
	/** The text's x and anchor: it starts right of the rule, or ends left of it near the right edge. */
	x: number;
	anchor: "start" | "end";
	/** How many variants were skipped to fit (0: the full text). */
	level: number;
}

export interface PlaceOptions {
	width: number;
	rows: number;
	measure: (text: string) => number;
	/** Between the rule and its text. */
	pad?: number;
	/** The least room between two labels in a row. */
	gap?: number;
}

interface Span {
	left: number;
	right: number;
	anchor: "start" | "end";
	at: number;
}

interface Slot {
	label: ChartLabel;
	level: number;
	span: Span;
}

function spanOf(x: number, textWidth: number, width: number, pad: number): Span {
	if (x + pad + textWidth <= width && x < width * 0.75)
		return { left: x + pad, right: x + pad + textWidth, anchor: "start", at: x + pad };
	const right = Math.min(width, x - pad);
	return { left: right - textWidth, right, anchor: "end", at: right };
}

/**
 * Places labels left to right by their rules without overlaps: each takes the first row its full text
 * fits in (staggering); when no row has room, the row where the fewest steps of shortening — of its own
 * text, or of the label before it in that row — make room; a label nothing makes room for is left out
 * (its rule still shows).
 */
export function placeLabels(labels: readonly ChartLabel[], options: PlaceOptions): PlacedLabel[] {
	const { width, rows, measure, pad = 4, gap = 6 } = options;
	const lanes: Slot[][] = Array.from({ length: Math.max(1, rows) }, () => []);
	const span = (label: ChartLabel, level: number): Span | null => {
		const text = label.variants[level];
		if (!text) return null;
		const out = spanOf(label.x, measure(text), width, pad);
		return out.left < 0 ? null : out;
	};
	const clear = (a: Span, b: Span) => a.right + gap <= b.left || b.right + gap <= a.left;
	const order = [...labels].sort((a, b) => a.x - b.x);
	for (const label of order) {
		let best: {
			lane: Slot[];
			level: number;
			span: Span;
			before: number | null;
			cost: number;
		} | null = null;
		for (const lane of lanes) {
			const last = lane.at(-1);
			for (let level = 0; level < label.variants.length; level++) {
				const own = span(label, level);
				if (!own || !lane.slice(0, -1).every((slot) => clear(slot.span, own))) continue;
				let before: number | null = null;
				if (last && !clear(last.span, own)) {
					for (let shorter = last.level + 1; shorter < last.label.variants.length; shorter++) {
						const next = span(last.label, shorter);
						if (next && clear(next, own)) {
							before = shorter;
							break;
						}
					}
					if (before === null) continue;
				}
				const cost = level + (before === null || !last ? 0 : before - last.level);
				if (!best || cost < best.cost) best = { lane, level, span: own, before, cost };
				break;
			}
		}
		if (!best) continue;
		const last = best.lane.at(-1);
		if (last && best.before !== null) {
			last.level = best.before;
			last.span = span(last.label, best.before) ?? last.span;
		}
		best.lane.push({ label, level: best.level, span: best.span });
	}
	const rank = new Map(order.map((label, at) => [label.key, at]));
	return lanes
		.flatMap((lane, row) =>
			lane.map((slot) => ({
				key: slot.label.key,
				text: slot.label.variants[slot.level] ?? "",
				row,
				x: slot.span.at,
				anchor: slot.span.anchor,
				level: slot.level,
			})),
		)
		.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
}

const FALLBACK_CHAR_PX = 7;

/** Measures text in a canvas `font` string; an estimate where there is no canvas. */
export function textMeasure(font: string): (text: string) => number {
	const context =
		typeof document === "undefined" || !font
			? null
			: document.createElement("canvas").getContext("2d");
	if (!context) return (text) => text.length * FALLBACK_CHAR_PX;
	context.font = font;
	return (text) => context.measureText(text).width;
}
