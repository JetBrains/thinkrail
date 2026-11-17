import type { ResourceRenderer } from "../../registry";
import { setInteractiveHtmlGlobs } from "./interactive";

export const htmlRenderer: ResourceRenderer = {
	id: "thinkrail/html",
	labelKey: "viewer.renderer.preview",
	match: { glob: ["*.html", "*.htm"], text: true },
	rank: 120,
	capabilities: {
		view: true,
		diff: true,
		anchors: { view: [], diff: [] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
		boundedDiff: "always",
	},
	loadView: () => import("./View"),
	loadDiff: () => import("./Diff"),
};

export function interactiveHtmlRenderer(globs: readonly string[]): ResourceRenderer {
	setInteractiveHtmlGlobs(globs);
	return {
		...htmlRenderer,
		id: "thinkrail/html-interactive",
		labelKey: "viewer.renderer.interactive",
		match: { glob: [...globs], text: true },
		rank: htmlRenderer.rank + 10,
		loadView: () => import("./InteractiveView"),
		loadDiff: () => import("./InteractiveDiff"),
	};
}
