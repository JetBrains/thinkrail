import type { ResourceRenderer } from "@/resources";

export const jsonRenderer: ResourceRenderer = {
	id: "thinkrail/json",
	label: "Tree",
	match: { glob: ["*.json", "*.jsonc"], text: true },
	rank: 120,
	capabilities: {
		view: true,
		diff: true,
		anchors: {
			view: ["line", "structural:json-pointer"],
			diff: ["line", "structural:json-pointer"],
		},
		mobile: true,
		copy: true,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
