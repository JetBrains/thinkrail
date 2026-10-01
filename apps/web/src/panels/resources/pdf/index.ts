import type { ResourceRenderer } from "@/resources";

export const pdfRenderer: ResourceRenderer = {
	id: "thinkrail/pdf",
	label: "PDF",
	match: { mime: ["application/pdf"], text: false },
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
