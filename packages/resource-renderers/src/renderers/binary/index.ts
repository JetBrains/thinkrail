import type { ResourceRenderer } from "../../registry";

export const binaryRenderer: ResourceRenderer = {
	id: "thinkrail/binary",
	labelKey: "viewer.renderer.file",
	match: { text: false },
	rank: 0,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: [], diff: [] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
	loadView: () => import("./BinaryView"),
	loadDiff: () => import("./BinaryDiff"),
};
