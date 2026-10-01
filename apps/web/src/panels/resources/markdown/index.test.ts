import { expect, test } from "bun:test";
import { registerResourceRenderer, resolveRenderers } from "@/resources";
import { binaryRenderer } from "../binary";
import { codeRenderer } from "../code";
import { markdownRenderer } from ".";

test("bundled renderers declare anchor placement per intent", () => {
	expect(codeRenderer.capabilities.anchors).toEqual({ view: ["line"], diff: ["line"] });
	expect(markdownRenderer.capabilities.anchors).toEqual({ view: ["line"], diff: [] });
	expect(binaryRenderer.capabilities.anchors).toEqual({ view: [], diff: [] });
});

test("a byte-only markdown path resolves to the binary fallback", () => {
	const disposers = [codeRenderer, markdownRenderer, binaryRenderer].map(registerResourceRenderer);
	try {
		expect(
			resolveRenderers(
				{
					workspaceId: "ws",
					path: "README.md",
					mime: "text/markdown",
					text: false,
					byteLength: 12,
				},
				"view",
				{ mobile: false },
			).map((renderer) => renderer.id),
		).toEqual(["thinkrail/binary"]);
	} finally {
		for (const dispose of disposers.reverse()) dispose();
	}
});
