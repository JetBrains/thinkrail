import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_SPEC_SEARCH_LIMIT, type SpecSectionHit, searchSpecs } from "../core/index.ts";
import { getSectionIndex, textResult } from "./shared.ts";

export const MAX_SPEC_SEARCH_LIMIT = 25;

const parameters = Type.Object({
	query: Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })], {
		description:
			"The question or topic, in the words a spec would use. Pass several phrasings as an array (synonyms, the names the code uses) to widen recall; they are ranked separately and fused.",
	}),
	type: Type.Optional(
		Type.String({ description: "Only search specs with this frontmatter type." }),
	),
	tag: Type.Optional(Type.String({ description: "Only search specs carrying this tag." })),
	parent: Type.Optional(Type.String({ description: "Only search specs whose parent is this id." })),
	limit: Type.Optional(
		Type.Number({
			description: `Max sections to return (default: ${DEFAULT_SPEC_SEARCH_LIMIT}, max: ${MAX_SPEC_SEARCH_LIMIT}).`,
		}),
	),
});

export interface SpecSearchDetails {
	hits: Pick<
		SpecSectionHit,
		"path" | "line" | "id" | "title" | "heading" | "snippet" | "matched" | "terms"
	>[];
	total: number;
}

function hitLine(hit: SpecSectionHit): string {
	const where = hit.heading ? `${hit.title} › ${hit.heading}` : hit.title;
	const snippet = hit.snippet ? ` — ${hit.snippet}` : "";
	const words = hit.matched < hit.terms ? ` (${hit.matched}/${hit.terms} words)` : "";
	return `${hit.path}:${hit.line}  ${where}${snippet}${words}`;
}

export function registerSpecSearch(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, SpecSearchDetails>({
		name: "spec_search",
		label: "Spec Search",
		description:
			"Find the spec sections that answer a question, ranked by words: each section's heading and text plus its spec's title, words in any order, word forms matched (renaming ↔ rename), identifiers split (renameSession ↔ rename session), an exact phrase first. Returns `path:line  Spec › Section — snippet`, best first; read a section at its line with the normal read tool. It matches words, not meaning: when nothing fits, retry with the words a spec would use or with several phrasings at once. Use spec_grep for an exact pattern or a regex.",
		promptSnippet:
			"spec_search — find the spec sections that govern a topic, ranked by words; spec_grep matches exact patterns.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const requested = Math.trunc(params.limit ?? DEFAULT_SPEC_SEARCH_LIMIT);
			const limit = Math.min(
				MAX_SPEC_SEARCH_LIMIT,
				requested > 0 ? requested : DEFAULT_SPEC_SEARCH_LIMIT,
			);
			const { hits, total } = searchSpecs(getSectionIndex(ctx.cwd), params.query, {
				limit,
				...(params.type !== undefined ? { type: params.type } : {}),
				...(params.tag !== undefined ? { tag: params.tag } : {}),
				...(params.parent !== undefined ? { parent: params.parent } : {}),
			});
			const details: SpecSearchDetails = {
				hits: hits.map(({ path, line, id, title, heading, snippet, matched, terms }) => ({
					path,
					line,
					id,
					title,
					heading,
					snippet,
					matched,
					terms,
				})),
				total,
			};
			if (hits.length === 0) {
				return textResult(
					"No matching sections. spec_search matches words, not meaning: retry with the words a spec would use, or use spec_grep for an exact pattern.",
					details,
				);
			}
			const header = `${hits.length} of ${total} matching section(s), best first:`;
			return textResult(`${header}\n${hits.map(hitLine).join("\n")}`, details);
		},
	});
}
