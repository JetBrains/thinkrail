import type { ResourceRenderer } from "@/resources";

export const imageRenderer: ResourceRenderer = {
	id: "thinkrail/image",
	label: "Image",
	match: { mime: ["image/*"], text: false },
	rank: 120,
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
