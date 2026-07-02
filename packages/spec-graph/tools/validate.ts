// spec_validate — report dangling links, duplicate ids, and parent cycles across the spec-graph.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isValid, type ValidationReport, validateGraph } from "../core/index.ts";
import { getIndex, textResult } from "./shared.ts";

const parameters = Type.Object({});

export function registerSpecValidate(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, ValidationReport>({
		name: "spec_validate",
		label: "Spec Validate",
		description:
			"Validate the spec-graph: report dangling parent/depends-on/references/implements links, duplicate ids, and parent cycles.",
		promptSnippet:
			"spec_validate — check the spec-graph for dangling links, duplicate ids, and parent cycles.",
		parameters,
		async execute(_callId, _params, _signal, _onUpdate, ctx) {
			const report = validateGraph(getIndex(ctx.cwd).graph());
			if (isValid(report)) return textResult("Spec-graph is valid: no issues found.", report);

			const sections: string[] = [];
			if (report.duplicateIds.length) {
				sections.push(
					`Duplicate ids (${report.duplicateIds.length}):\n${report.duplicateIds
						.map((d) => `  ${d.id}: ${d.paths.join(", ")}`)
						.join("\n")}`,
				);
			}
			if (report.danglingLinks.length) {
				sections.push(
					`Dangling links (${report.danglingLinks.length}):\n${report.danglingLinks
						.map((d) => `  ${d.from} (${d.fromPath}) --${d.kind}--> ${d.target} [missing]`)
						.join("\n")}`,
				);
			}
			if (report.parentCycles.length) {
				sections.push(
					`Parent cycles (${report.parentCycles.length}):\n${report.parentCycles
						.map((c) => `  ${c.ids.join(" -> ")} -> ${c.ids[0]}`)
						.join("\n")}`,
				);
			}
			return textResult(sections.join("\n\n"), report);
		},
	});
}
