import type { ResourceRenderer } from "@/resources";

export const htmlRenderer: ResourceRenderer = {
	id: "thinkrail/html",
	label: "Preview",
	match: { glob: ["*.html", "*.htm"], text: true },
	rank: 120,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: [], diff: [] },
		mobile: true,
		active: true,
	},
	trust: "bundled",
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};
