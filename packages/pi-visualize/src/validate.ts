import type { VisualizeParams } from "./schema.ts";

/**
 * Enforce the per-`type` shape that the flat schema can't. Throws a clear `Error` on bad input — pi
 * turns a thrown error into an error tool-result. Validates *shape* only; mermaid *syntax* is a
 * render-time concern (the UI reports parse errors), not this function's job.
 */
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
