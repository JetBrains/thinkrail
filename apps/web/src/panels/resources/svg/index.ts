import type { ResourceRenderer } from "@/resources";

export const svgRenderer: ResourceRenderer = {
	id: "thinkrail/svg",
	label: "Vector",
	match: { mime: ["image/svg+xml"], text: true },
	rank: 130,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: ["region"], diff: ["region"] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
