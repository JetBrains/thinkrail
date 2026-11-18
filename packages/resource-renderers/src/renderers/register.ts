import { registerResourceRenderer } from "../registry";
import { binaryRenderer } from "./binary";
import { codeRenderer } from "./code";
import { csvRenderer } from "./csv";
import { htmlRenderer, interactiveHtmlRenderer } from "./html";
import { imageRenderer } from "./image";
import { jsonRenderer } from "./json";
import { lfsRenderer } from "./lfs";
import { markdownRenderer } from "./markdown";
import { notebookRenderer } from "./notebook";
import { pdfRenderer } from "./pdf";
import { svgRenderer } from "./svg";

let registered = false;

export interface BundledRendererOptions {
	interactiveHtml?: readonly string[];
}

export function registerBundledResourceRenderers(options: BundledRendererOptions = {}): void {
	if (registered) return;
	registered = true;
	registerResourceRenderer(codeRenderer);
	registerResourceRenderer(lfsRenderer);
	registerResourceRenderer(svgRenderer);
	registerResourceRenderer(notebookRenderer);
	registerResourceRenderer(imageRenderer);
	registerResourceRenderer(csvRenderer);
	registerResourceRenderer(jsonRenderer);
	registerResourceRenderer(pdfRenderer);
	registerResourceRenderer(htmlRenderer);
	if (options.interactiveHtml?.length) {
		registerResourceRenderer(interactiveHtmlRenderer(options.interactiveHtml));
	}
	registerResourceRenderer(markdownRenderer);
	registerResourceRenderer(binaryRenderer);
}
