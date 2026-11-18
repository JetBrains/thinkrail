import type { ResourceRenderer } from "../../registry";

export const SOURCE_RENDERER_ID = "thinkrail/code";

export const codeRenderer: ResourceRenderer = {
	id: SOURCE_RENDERER_ID,
	labelKey: "viewer.renderer.source",
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
		preload: true,
	},
	loadView: ({ mobile }) =>
		mobile ? import("./PierreFile") : import("../../support/MonacoEditor"),
	loadDiff: () => import("./PierreDiff"),
};
