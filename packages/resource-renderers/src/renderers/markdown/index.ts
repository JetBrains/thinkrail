import type { ResourceRenderer } from "../../registry";

export const markdownRenderer: ResourceRenderer = {
	id: "thinkrail/markdown",
	label: "Preview",
	match: { glob: ["*.md", "*.mdx"], text: true },
	rank: 110,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: ["line"], diff: [] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("../../support/MarkdownPreview"),
	loadDiff: () => import("../../support/RenderedDiff"),
};
