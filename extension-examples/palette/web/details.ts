export interface CardSwatch {
	hex: string;
	role: string;
	contrast?: { text: "white" | "black"; ratio: number; rating: string };
}

export interface CardPalette {
	base: string;
	harmony: string;
	colors: CardSwatch[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function swatch(value: unknown): CardSwatch | undefined {
	const fields = record(value);
	if (typeof fields?.hex !== "string" || !/^#[0-9a-f]{6}$/i.test(fields.hex)) return undefined;
	const role = typeof fields.role === "string" ? fields.role : "";
	const contrast = record(fields.contrast);
	if (
		(contrast?.text === "white" || contrast?.text === "black") &&
		typeof contrast.ratio === "number" &&
		typeof contrast.rating === "string"
	) {
		return {
			hex: fields.hex,
			role,
			contrast: { text: contrast.text, ratio: contrast.ratio, rating: contrast.rating },
		};
	}
	return { hex: fields.hex, role };
}

export function paletteFromResult(result: unknown): CardPalette | undefined {
	const details = record(record(result)?.details);
	if (!details || !Array.isArray(details.colors)) return undefined;
	const colors = details.colors.map(swatch).filter((color) => color !== undefined);
	if (colors.length === 0) return undefined;
	return {
		base: typeof details.base === "string" ? details.base : (colors[0]?.hex ?? ""),
		harmony: typeof details.harmony === "string" ? details.harmony : "",
		colors,
	};
}

export function cssVariables(palette: CardPalette): string {
	return palette.colors.map((color, index) => `--palette-${index + 1}: ${color.hex};`).join("\n");
}
