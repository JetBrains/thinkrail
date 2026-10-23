import { DEFAULT_MAX_BYTES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_GREP_LIMIT, formatGrepMatch, type GrepResult, grepSpecs } from "../core/index.ts";
import { errorResult, getIndex, textResult } from "./shared.ts";

const parameters = Type.Object({
	pattern: Type.String({ description: "Regex or substring to search for within spec files." }),
	regex: Type.Optional(
		Type.Boolean({ description: "Treat pattern as a regular expression (default: substring)." }),
	),
	ignoreCase: Type.Optional(
		Type.Boolean({ description: "Case-insensitive match (default: true)." }),
	),
	type: Type.Optional(
		Type.String({ description: "Only search specs with this frontmatter type." }),
	),
	tag: Type.Optional(Type.String({ description: "Only search specs carrying this tag." })),
	parent: Type.Optional(Type.String({ description: "Only search specs whose parent is this id." })),
	dependsOn: Type.Optional(
		Type.String({ description: "Only search specs that depend-on this id." }),
	),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: `Matches per page (default/max: ${DEFAULT_GREP_LIMIT}; the byte limit may return fewer).`,
		}),
	),
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			description:
				"Zero-based match offset (default: 0). Continue with nextOffset and the same filters; restart after source changes.",
		}),
	),
});

export function registerSpecGrep(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, GrepResult | { error: string }>({
		name: "spec_grep",
		label: "Spec Grep",
		description:
			"Search the project's spec-graph: regex or substring match within spec files (files whose frontmatter carries `id` + `type`), optionally narrowed by metadata (type / tag / parent / depends-on). Returns size-bounded pages of path:line matches; follow the returned offset only if needed. Oversized text is capped at 2,000 lines / 50 KiB with full output in a temporary file. Read a matched file's body with the normal read tool.",
		promptSnippet:
			"spec_grep — search specs by content when documented decisions, contracts, or boundaries may govern the work.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const index = getIndex(ctx.cwd);
			let result: GrepResult;
			try {
				result = grepSpecs(index.contentEntries(), {
					pattern: params.pattern,
					...(params.regex !== undefined ? { regex: params.regex } : {}),
					...(params.ignoreCase !== undefined ? { ignoreCase: params.ignoreCase } : {}),
					...(params.type !== undefined ? { type: params.type } : {}),
					...(params.tag !== undefined ? { tag: params.tag } : {}),
					...(params.parent !== undefined ? { parent: params.parent } : {}),
					...(params.dependsOn !== undefined ? { dependsOn: params.dependsOn } : {}),
					limit: Math.min(params.limit ?? DEFAULT_GREP_LIMIT, DEFAULT_GREP_LIMIT),
					offset: params.offset ?? 0,
					maxBytes: DEFAULT_MAX_BYTES - 2048,
				});
			} catch (err) {
				return errorResult(`Invalid search pattern: ${(err as Error).message}`);
			}
			const { matches, truncated } = result;
			const header =
				matches.length === 0
					? "No matches."
					: `${matches.length} match(es)${truncated ? " (truncated)" : ""}:`;
			const body = matches.map(formatGrepMatch).join("\n");
			const continuation =
				result.nextOffset === undefined
					? ""
					: `More matches: repeat spec_grep with the same filters and offset: ${result.nextOffset}, or narrow the search.`;
			return textResult(`${header}\n${body}`.trimEnd(), result, continuation);
		},
	});
}
