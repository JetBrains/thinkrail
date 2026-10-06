export interface SvgThemeTokens {
	background: string;
	foreground: string;
}

export type SvgDiffMode = "2-up" | "swipe" | "onion" | "difference";

const SVG_DIFF_MODES: readonly SvgDiffMode[] = ["2-up", "swipe", "onion", "difference"];

function cssValue(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replace(/[{};]/g, "");
}

export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildSvgDocument(svg: string, tokens: SvgThemeTokens): string {
	const background = cssValue(tokens.background);
	const foreground = cssValue(tokens.foreground);
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>:root{--svg-surface:${background};--svg-foreground:${foreground}}html,body{width:100%;height:100%;margin:0;background:var(--svg-surface);color:var(--svg-foreground)}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="${svgDataUrl(svg)}" alt=""></body></html>`;
}

function numericLength(value: string | undefined): number | null {
	if (!value) return null;
	const match = /^\s*([+]?(?:\d+\.?\d*|\.\d+))(?:px)?\s*$/i.exec(value);
	if (!match) return null;
	const number = Number(match[1]);
	return Number.isFinite(number) && number > 0 ? number : null;
}

function viewBoxSize(value: string | undefined): { width: number; height: number } | null {
	const viewBox = value
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		viewBox?.length !== 4 ||
		!viewBox.every(Number.isFinite) ||
		(viewBox[2] ?? 0) <= 0 ||
		(viewBox[3] ?? 0) <= 0
	) {
		return null;
	}
	return { width: viewBox[2] as number, height: viewBox[3] as number };
}

export function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
	const root = /<svg\b([^>]*)>/i.exec(svg)?.[1];
	if (root === undefined) return null;
	const attribute = (name: string) =>
		new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
	const width = numericLength(attribute("width"));
	const height = numericLength(attribute("height"));
	const viewBox = viewBoxSize(attribute("viewBox"));
	if (width !== null && height !== null) return { width, height };
	if (width !== null) {
		return {
			width,
			height: viewBox ? (width * viewBox.height) / viewBox.width : 150,
		};
	}
	if (height !== null) {
		return {
			width: viewBox ? (height * viewBox.width) / viewBox.height : 300,
			height,
		};
	}
	return viewBox ?? { width: 300, height: 150 };
}

export function svgByteLength(svg: string): number {
	return new TextEncoder().encode(svg).byteLength;
}

export function svgDiffViewState(state: unknown): SvgDiffMode {
	if (typeof state !== "object" || state === null) return "2-up";
	const mode = Reflect.get(state, "mode");
	return SVG_DIFF_MODES.find((candidate) => candidate === mode) ?? "2-up";
}
