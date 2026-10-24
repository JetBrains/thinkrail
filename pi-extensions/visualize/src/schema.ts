import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

const ComparisonOptionSchema = Type.Object({
	name: Type.String({ description: "Short label for this option." }),
	description: Type.Optional(
		Type.String({ description: "One or two sentences describing the option." }),
	),
	pros: Type.Optional(Type.Array(Type.String(), { description: "Advantages of this option." })),
	cons: Type.Optional(Type.Array(Type.String(), { description: "Drawbacks of this option." })),
	recommended: Type.Optional(
		Type.Boolean({ description: "Set true on the single option you endorse; it is highlighted." }),
	),
	mermaid: Type.Optional(
		Type.String({ description: "Optional raw mermaid diagram illustrating this option." }),
	),
});

export const VisualizeSchema = Type.Object({
	type: StringEnum(["diagram", "comparison", "file"], {
		description:
			"Which visualization to render. 'diagram' needs `mermaid`; 'comparison' needs `options`; 'file' needs `path`.",
	}),
	title: Type.Optional(
		Type.String({ description: "Optional heading shown above the visualization." }),
	),
	mermaid: Type.Optional(
		Type.String({
			description:
				"Required when type='diagram'. Raw mermaid source of any kind (flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, …).",
		}),
	),
	options: Type.Optional(
		Type.Array(ComparisonOptionSchema, {
			description: "Required when type='comparison'. The alternatives being compared.",
		}),
	),
	path: Type.Optional(
		Type.String({
			description:
				"Required when type='file'. Workspace-relative path of an existing file to show rendered by its type (HTML, Markdown, SVG, CSV, JSON, notebook, image, PDF, or code).",
		}),
	),
	before: Type.Optional(
		Type.String({
			description:
				"Optional with type='file'. Workspace-relative path of the previous version; the file is then shown as a before/after diff.",
		}),
	),
});

export type VisualizeParams = Static<typeof VisualizeSchema>;
export type ComparisonOption = Static<typeof ComparisonOptionSchema>;
