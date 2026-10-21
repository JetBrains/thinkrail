import type { ResourceRenderer } from "../../registry";

export const codeRenderer: ResourceRenderer = {
	id: "thinkrail/code",
	label: "Source",
	match: { text: true },
	rank: 100,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: ["line"], diff: ["line"] },
		mobile: true,
		copy: true,
		layout: true,
		whitespace: true,
		boundedDiff: "large",
	},
	loadView: ({ mobile }) =>
		mobile ? import("./PierreFile") : import("../../support/MonacoEditor"),
	loadDiff: () => import("./PierreDiff"),
};
