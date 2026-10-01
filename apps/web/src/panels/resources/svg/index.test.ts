import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerResourceRenderer, resolveRenderers } from "@/resources";
import { codeRenderer } from "../code";
import { imageRenderer } from "../image";
import { svgRenderer } from ".";
import { SvgFrame } from "./SvgFrame";
import {
	buildSvgDocument,
	svgByteLength,
	svgDataUrl,
	svgDiffViewState,
	svgFileDraft,
	svgIntrinsicSize,
} from "./svgDocument";

test("SVG renderer registration outranks raster images and stays sandboxed", () => {
	expect(svgRenderer).toMatchObject({
		id: "thinkrail/svg",
		label: "Vector",
		match: { mime: ["image/svg+xml"], text: true },
		rank: 130,
		capabilities: {
			anchors: { view: ["region"], diff: ["region"] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
	});
});

test("text SVG resolves to Vector and Source without the raster renderer", () => {
	const disposers = [codeRenderer, imageRenderer, svgRenderer].map(registerResourceRenderer);
	try {
		expect(
			resolveRenderers(
				{
					workspaceId: "ws",
					path: "diagram.svg",
					mime: "image/svg+xml",
					text: true,
				},
				"view",
				{ mobile: false },
			).map((renderer) => renderer.label),
		).toEqual(["Vector", "Source"]);
	} finally {
		for (const dispose of disposers.reverse()) dispose();
	}
});

test("SVG documents keep hostile markup inside an inert data image", () => {
	const attacks = [
		'</svg><meta http-equiv="refresh" content="0;url=https://attacker.invalid">',
		'<svg><script>location="https://attacker.invalid"</script></svg>',
		'<svg><image href="https://attacker.invalid/pixel.png" /></svg>',
	];
	for (const svg of attacks) {
		const document = buildSvgDocument(svg, {
			background: "canvas-token",
			foreground: "text-token",
		});
		const dataUrl = svgDataUrl(svg);
		expect(document).toContain(
			`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`,
		);
		expect(document).toContain(`src="${dataUrl}"`);
		expect(document.split(dataUrl)).toHaveLength(2);
		expect(document.replace(dataUrl, "")).not.toContain(svg);
		expect(document).not.toContain("https://attacker.invalid");
		const encoded = /<img src="([^"]+)" alt="">/.exec(document)?.[1];
		expect(encoded?.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
		expect(decodeURIComponent(encoded?.slice(encoded.indexOf(",") + 1) ?? "")).toBe(svg);
	}
});

test("SVG frames carry exactly an empty sandbox capability set", () => {
	const markup = renderToStaticMarkup(
		createElement(SvgFrame, {
			title: "Vector preview",
			document: buildSvgDocument("<svg></svg>", {
				background: "canvas-token",
				foreground: "text-token",
			}),
		}),
	);
	const openingTag = markup.slice(0, markup.indexOf(">") + 1);
	expect([...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([""]);
	expect(openingTag).not.toContain("allow-");
});

test("SVG documents carry token values and intrinsic geometry", () => {
	const svg = '<svg viewBox="0 0 320 180"><rect width="10" height="10" /></svg>';
	const document = buildSvgDocument(svg, {
		background: "canvas-token",
		foreground: "text-token",
	});
	expect(document).toContain("--svg-surface:canvas-token");
	expect(svgIntrinsicSize(svg)).toEqual({ width: 320, height: 180 });
	expect(svgIntrinsicSize('<svg width="24" height="16"></svg>')).toEqual({
		width: 24,
		height: 16,
	});
	expect(svgIntrinsicSize("<svg></svg>")).toEqual({ width: 300, height: 150 });
	expect(svgByteLength("é")).toBe(2);
	expect(svgFileDraft()).toEqual({ selectors: [], label: "file" });
	expect(svgDiffViewState({ mode: "difference" })).toBe("difference");
});
