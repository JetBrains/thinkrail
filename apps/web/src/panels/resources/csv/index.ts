import type { ResourceRenderer } from "@/resources";

export const csvRenderer: ResourceRenderer = {
	id: "thinkrail/csv",
	label: "Table",
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
		boundedDiff: true,
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
