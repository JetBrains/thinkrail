import type { ResourceRenderer } from "../../registry";

export const csvRenderer: ResourceRenderer = {
	id: "thinkrail/csv",
	labelKey: "viewer.renderer.table",
	match: { glob: ["*.csv", "*.tsv"], text: true },
	rank: 120,
	capabilities: {
		view: true,
		diff: true,
		anchors: {
			view: ["line", "structural:table-cell"],
			diff: ["line", "structural:table-cell"],
		},
		mobile: true,
		copy: true,
		layout: false,
		whitespace: false,
		boundedDiff: "always",
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
