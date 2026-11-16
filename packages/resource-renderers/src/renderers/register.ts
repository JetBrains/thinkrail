import { registerResourceRenderer } from "../registry";
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

let registered = false;

export function registerBundledResourceRenderers(): void {
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
	registerResourceRenderer(markdownRenderer);
	registerResourceRenderer(binaryRenderer);
}
