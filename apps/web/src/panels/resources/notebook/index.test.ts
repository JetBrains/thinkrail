import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HTML_PREVIEW_CSP } from "../html/htmlDocument";
import { notebookRenderer } from ".";
import { NotebookFrame } from "./NotebookOutputView";
import {
	buildNotebookSvgDocument,
	NOTEBOOK_HTML_CSP,
	notebookImageDataUrl,
} from "./outputDocument";

test("notebook renderer registration declares cell anchors and active output content", () => {
	expect(notebookRenderer).toMatchObject({
		id: "thinkrail/notebook",
		label: "Notebook",
		match: { glob: ["*.ipynb"], text: true },
		rank: 130,
		capabilities: {
			anchors: {
				view: ["line", "structural:ipynb-cell"],
				diff: ["line", "structural:ipynb-cell"],
			},
			mobile: true,
			active: true,
		},
	});
});

test("notebook HTML output uses the shared sanitized-preview CSP and an empty sandbox", () => {
	expect(NOTEBOOK_HTML_CSP).toBe(HTML_PREVIEW_CSP);
	const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${NOTEBOOK_HTML_CSP}"></head></html>`;
	const markup = renderToStaticMarkup(createElement(NotebookFrame, { title: "Output", document }));
	const openingTag = markup.slice(0, markup.indexOf(">") + 1);
	expect([...openingTag.matchAll(/\ssandbox="([^"]*)"/g)].map((match) => match[1])).toEqual([""]);
	expect(openingTag).not.toContain("allow-");
});

test("SVG notebook output stays inside a data image document", () => {
	const svg = '<svg><script>location="https://attacker.invalid"</script></svg>';
	const document = buildNotebookSvgDocument(svg);
	const url = notebookImageDataUrl("image/svg+xml", svg);
	expect(document).toContain(`src="${url}"`);
	expect(document.replace(url, "")).not.toContain(svg);
	expect(document.replace(url, "")).not.toContain("https://attacker.invalid");
});
