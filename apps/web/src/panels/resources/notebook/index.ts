import type { ResourceRenderer } from "@/resources";

export const notebookRenderer: ResourceRenderer = {
	id: "thinkrail/notebook",
	label: "Notebook",
	match: { glob: ["*.ipynb"], text: true },
	rank: 130,
	capabilities: {
		view: true,
		diff: true,
		anchors: {
			view: ["line", "structural:ipynb-cell"],
			diff: ["line", "structural:ipynb-cell"],
		},
		mobile: true,
		copy: true,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
