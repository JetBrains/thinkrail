import type { ResourceRenderer } from "../../registry";

export const pdfRenderer: ResourceRenderer = {
	id: "thinkrail/pdf",
	labelKey: "viewer.renderer.pdf",
	match: { mime: ["application/pdf"], text: false },
	rank: 120,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: ["region"], diff: ["region"] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
		boundedDiff: "always",
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
