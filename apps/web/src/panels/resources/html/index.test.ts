import { expect, test } from "bun:test";
import { htmlRenderer } from ".";

test("HTML renderer registration has no review geometry and stays sandboxed", () => {
	expect(htmlRenderer).toMatchObject({
		id: "thinkrail/html",
		label: "Preview",
		match: { glob: ["*.html", "*.htm"], text: true },
		rank: 120,
		capabilities: {
			anchors: { view: [], diff: [] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
	});
});
