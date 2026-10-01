import { isPhoneViewport } from "@/lib";
import type { ResourceRenderer } from "@/resources";

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
		active: false,
	},
	trust: "bundled",
	loadView: () => (isPhoneViewport() ? import("./PlainCodeView") : import("../../MonacoEditor")),
	loadDiff: () => import("../../MonacoDiff"),
};
