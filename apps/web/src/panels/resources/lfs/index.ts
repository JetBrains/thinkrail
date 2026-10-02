import type { ResourceRenderer } from "@/resources";

export const lfsRenderer: ResourceRenderer = {
	id: "thinkrail/lfs",
	label: "LFS",
	match: { mime: ["application/vnd.git-lfs"], text: true },
	rank: 130,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: [], diff: [] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
