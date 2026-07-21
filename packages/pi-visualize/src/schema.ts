import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

/** One alternative in a `comparison` visualization. */
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

/**
 * Tool parameters for `visualize`. A single flat object (top-level object schemas are what tool /
 * function-calling APIs expect), discriminated by `type`. Per-type fields are optional in the schema
 * and enforced at runtime by `validateShape`.
 */
export const VisualizeSchema = Type.Object({
	type: StringEnum(["diagram", "comparison"], {
		description:
			"Which visualization to render. 'diagram' needs `mermaid`; 'comparison' needs `options`.",
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
});

export type VisualizeParams = Static<typeof VisualizeSchema>;
export type ComparisonOption = Static<typeof ComparisonOptionSchema>;
