import {
	type RemixiconComponentType,
	RiBracesLine,
	RiFileLine,
	RiFilePdf2Line,
	RiImageLine,
	RiPagesLine,
	RiStickyNoteLine,
	RiTableLine,
} from "@remixicon/react";

export interface OutputFileLabel {
	name: string;
	type: string | null;
}

const TYPES: Readonly<Record<string, { type: string; icon: RemixiconComponentType }>> = {
	md: { type: "MD", icon: RiStickyNoteLine },
	markdown: { type: "MD", icon: RiStickyNoteLine },
	html: { type: "HTML", icon: RiPagesLine },
	htm: { type: "HTML", icon: RiPagesLine },
	pdf: { type: "PDF", icon: RiFilePdf2Line },
	svg: { type: "SVG", icon: RiImageLine },
	png: { type: "PNG", icon: RiImageLine },
	jpg: { type: "JPG", icon: RiImageLine },
	jpeg: { type: "JPG", icon: RiImageLine },
	gif: { type: "GIF", icon: RiImageLine },
	webp: { type: "WEBP", icon: RiImageLine },
	avif: { type: "AVIF", icon: RiImageLine },
	bmp: { type: "BMP", icon: RiImageLine },
	csv: { type: "CSV", icon: RiTableLine },
	json: { type: "JSON", icon: RiBracesLine },
};

function split(path: string): { base: string; stem: string; ext: string } {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot > 0
		? { base, stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() }
		: { base, stem: base, ext: "" };
}

export function outputFileLabel(path: string): OutputFileLabel {
	const { base, stem, ext } = split(path);
	const known = TYPES[ext];
	return known ? { name: stem.replaceAll("_", " "), type: known.type } : { name: base, type: null };
}

export function outputFileIcon(path: string): RemixiconComponentType {
	return TYPES[split(path).ext]?.icon ?? RiFileLine;
}
