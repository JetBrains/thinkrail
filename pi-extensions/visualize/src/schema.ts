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
	html: Type.Optional(
		Type.String({
			description:
				"Optional static HTML mockup of this option (same rules as a 'mockup' document).",
		}),
	),
});

const MOCKUP_HTML_RULES =
	"A self-contained static HTML document or fragment: HTML + inline <style>/style attributes, no scripts. Images, icons and fonts are inline SVG, data: URLs, or paths relative to the workspace root; http(s) resources are blocked.";

export const VisualizeSchema = Type.Object({
	type: StringEnum(["diagram", "comparison", "mockup"], {
		description:
			"Which visualization to render. 'diagram' needs `mermaid`; 'comparison' needs `options`; 'mockup' needs `html`, or `before` and `after`.",
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
	html: Type.Optional(
		Type.String({
			description: `For type='mockup': one UI mockup. ${MOCKUP_HTML_RULES}`,
		}),
	),
	before: Type.Optional(
		Type.String({
			description:
				"For type='mockup' instead of `html`: the current UI, paired with `after`. Same rules as `html`.",
		}),
	),
	after: Type.Optional(
		Type.String({
			description:
				"For type='mockup' instead of `html`: the proposed UI, paired with `before`. Same rules as `html`.",
		}),
	),
	viewport: Type.Optional(
		StringEnum(["desktop", "tablet", "phone"], {
			description:
				"For mockups: the screen width the HTML is designed for (desktop 1280px, tablet 768px, phone 390px). Defaults to desktop; the user can switch.",
		}),
	),
});

export type VisualizeParams = Static<typeof VisualizeSchema>;
export type ComparisonOption = Static<typeof ComparisonOptionSchema>;
export type MockupViewport = NonNullable<VisualizeParams["viewport"]>;
