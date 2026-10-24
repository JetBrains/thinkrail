import type { ResourceRenderer } from "../../registry";

export const svgRenderer: ResourceRenderer = {
	id: "thinkrail/svg",
	labelKey: "viewer.renderer.vector",
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
