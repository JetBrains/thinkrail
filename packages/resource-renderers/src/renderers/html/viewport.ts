export const HTML_VIEWPORTS = ["desktop", "tablet", "phone", "responsive"] as const;

export type HtmlViewport = (typeof HTML_VIEWPORTS)[number];

export const HTML_VIEWPORT_LABELS: Record<HtmlViewport, string> = {
	desktop: "Desktop",
	tablet: "Tablet",
	phone: "Phone",
	responsive: "Fill",
};

const DESIGN_WIDTHS: Record<Exclude<HtmlViewport, "responsive">, number> = {
	desktop: 1280,
	tablet: 768,
	phone: 390,
};

export interface HtmlFrameGeometry {
	width: number;
	height: number;
	scale: number;
}

export function htmlFrameGeometry(
	viewport: HtmlViewport,
	box: { width: number; height: number },
): HtmlFrameGeometry {
	if (viewport === "responsive" || box.width <= 0) {
		return { width: box.width, height: box.height, scale: 1 };
	}
	const width = DESIGN_WIDTHS[viewport];
	const scale = Math.min(1, box.width / width);
	return { width, height: box.height / scale, scale };
}

export function htmlViewport(viewState: unknown): HtmlViewport {
	const value =
		typeof viewState === "object" && viewState !== null
			? (viewState as { viewport?: unknown }).viewport
			: undefined;
	return HTML_VIEWPORTS.find((candidate) => candidate === value) ?? "desktop";
}
