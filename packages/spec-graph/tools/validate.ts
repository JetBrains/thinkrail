import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	FIELDS,
	formatLintFinding,
	isValid,
	type LintReport,
	lintSpecs,
	scalar,
	type ValidationReport,
	validateGraph,
} from "../core/index.ts";
import { errorResult, getIndex, textResult } from "./shared.ts";

const MAX_LISTED_FINDINGS = 40;

const parameters = Type.Object({
	id: Type.Optional(
		Type.String({
			description:
				"Limit the structure warnings to this spec id. Link validation always covers the whole graph.",
		}),
	),
});

type Report = ValidationReport & { lint: LintReport };

function structureBlock(lint: LintReport, scoped: boolean): string {
	if (lint.findings.length === 0) {
		return scoped ? "Structure: no warnings for this spec." : "Structure: no warnings.";
	}
	const perRule = new Map<string, number>();
	for (const f of lint.findings) perRule.set(f.rule, (perRule.get(f.rule) ?? 0) + 1);
	const summary = [...perRule.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([rule, n]) => `${rule} ${n}`)
		.join(", ");
	const files = new Set(lint.findings.map((f) => f.path)).size;
	const listed = lint.findings
		.slice(0, MAX_LISTED_FINDINGS)
		.map((f) => `  ${formatLintFinding(f)}`);
	const more = lint.findings.length - listed.length;
	if (more > 0) listed.push(`  … ${more} more (pass id to scope to one spec)`);
	return `Structure warnings (${lint.findings.length} in ${files} spec${files === 1 ? "" : "s"}; ${summary}):\n${listed.join("\n")}`;
}

export function registerSpecValidate(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, Report | { error: string }>({
		name: "spec_validate",
		label: "Spec Validate",
		description:
			"Validate the spec-graph: report dangling parent/depends-on/references/implements links, duplicate ids, and parent cycles (errors), plus per-spec structure warnings against the shape budgets — size, heading gaps, long list items, wide table cells, and missing/unknown/empty skeleton sections in module specs. Pass id to scope the structure warnings to one spec.",
		promptSnippet:
			"spec_validate — check the spec-graph for dangling links, duplicate ids, parent cycles, and per-spec structure warnings (size, headings, list items, tables, skeleton sections).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const index = getIndex(ctx.cwd);
			const graph = validateGraph(index.graph());
			let entries = index.contentEntries();
			if (params.id !== undefined) {
				entries = entries.filter((e) => scalar(e.frontmatter, FIELDS.id) === params.id);
				if (entries.length === 0) return errorResult(`No spec with id "${params.id}".`);
			}
			const lint = lintSpecs(entries);
			const report: Report = { ...graph, lint };
			const structure = structureBlock(lint, params.id !== undefined);

			if (isValid(graph)) {
				return textResult(
					lint.findings.length === 0
						? `Spec-graph is valid: no issues found. ${structure}`
						: `Spec-graph links are valid.\n\n${structure}`,
					report,
				);
			}

			const sections: string[] = [];
			if (graph.duplicateIds.length) {
				sections.push(
					`Duplicate ids (${graph.duplicateIds.length}):\n${graph.duplicateIds
						.map((d) => `  ${d.id}: ${d.paths.join(", ")}`)
						.join("\n")}`,
				);
			}
			if (graph.danglingLinks.length) {
				sections.push(
					`Dangling links (${graph.danglingLinks.length}):\n${graph.danglingLinks
						.map((d) => `  ${d.from} (${d.fromPath}) --${d.kind}--> ${d.target} [missing]`)
						.join("\n")}`,
				);
			}
			if (graph.parentCycles.length) {
				sections.push(
					`Parent cycles (${graph.parentCycles.length}):\n${graph.parentCycles
						.map((c) => `  ${c.ids.join(" -> ")} -> ${c.ids[0]}`)
						.join("\n")}`,
				);
			}
			sections.push(structure);
			return textResult(sections.join("\n\n"), report);
		},
	});
}
