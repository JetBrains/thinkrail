import type { VisualizeParams } from "./schema.ts";

export interface MermaidSource {
	location: string;
	source: string;
}

export function mermaidSources(params: VisualizeParams): MermaidSource[] {
	if (params.type === "diagram") {
		return [{ location: "mermaid", source: params.mermaid ?? "" }];
	}
	return (params.options ?? []).flatMap((option, index) =>
		option.mermaid ? [{ location: `options[${index}].mermaid`, source: option.mermaid }] : [],
	);
}

export function validateShape(params: VisualizeParams): void {
	if (params.type === "diagram") {
		if (!params.mermaid || params.mermaid.trim() === "") {
			throw new Error(
				'visualize: `mermaid` is required and must be a non-empty string when type is "diagram".',
			);
		}
		return;
	}

	if (params.type === "comparison") {
		if (!params.options || params.options.length === 0) {
			throw new Error(
				'visualize: `options` is required and must be a non-empty array when type is "comparison".',
			);
		}
		params.options.forEach((opt, i) => {
			if (!opt.name || opt.name.trim() === "") {
				throw new Error(`visualize: options[${i}].name is required and must be non-empty.`);
			}
		});
	}
}
