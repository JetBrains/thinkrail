import { expect, test } from "bun:test";
import { binaryRenderer } from "./binary";
import { codeRenderer } from "./code";
import { csvRenderer } from "./csv";
import { htmlRenderer } from "./html";
import { imageRenderer } from "./image";
import { jsonRenderer } from "./json";
import { lfsRenderer } from "./lfs";
import { markdownRenderer } from "./markdown";
import { notebookRenderer } from "./notebook";
import { pdfRenderer } from "./pdf";
import { svgRenderer } from "./svg";

const renderers = [
	binaryRenderer,
	codeRenderer,
	csvRenderer,
	htmlRenderer,
	imageRenderer,
	jsonRenderer,
	lfsRenderer,
	markdownRenderer,
	notebookRenderer,
	pdfRenderer,
	svgRenderer,
];

test("bundled renderer registrations declare only supported diff controls", () => {
	expect(
		Object.fromEntries(
			renderers.map((renderer) => [
				renderer.id,
				{
					copy: renderer.capabilities.copy,
					layout: renderer.capabilities.layout,
					whitespace: renderer.capabilities.whitespace,
				},
			]),
		),
	).toEqual({
		"thinkrail/binary": { copy: false, layout: false, whitespace: false },
		"thinkrail/code": { copy: true, layout: true, whitespace: true },
		"thinkrail/csv": { copy: true, layout: false, whitespace: false },
		"thinkrail/html": { copy: false, layout: false, whitespace: false },
		"thinkrail/image": { copy: false, layout: false, whitespace: false },
		"thinkrail/json": { copy: true, layout: false, whitespace: false },
		"thinkrail/lfs": { copy: false, layout: false, whitespace: false },
		"thinkrail/markdown": { copy: false, layout: false, whitespace: false },
		"thinkrail/notebook": { copy: true, layout: false, whitespace: false },
		"thinkrail/pdf": { copy: false, layout: false, whitespace: false },
		"thinkrail/svg": { copy: false, layout: false, whitespace: false },
	});
});
