import type { ResourceRenderer } from "@/resources";

export const binaryRenderer: ResourceRenderer = {
	id: "thinkrail/binary",
	label: "File",
	match: { text: false },
	rank: 0,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: [], diff: [] },
		mobile: true,
		active: false,
	},
	trust: "bundled",
	loadView: () => import("./BinaryView"),
	loadDiff: () => import("./BinaryDiff"),
};
