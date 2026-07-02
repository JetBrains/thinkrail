// spec_grep — regex/substring search within the spec set, narrowed by optional metadata filters.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type GrepResult, grepSpecs } from "../core/index.ts";
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
	limit: Type.Optional(Type.Number({ description: "Max matches to return (default: 200)." })),
});

export function registerSpecGrep(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, GrepResult | { error: string }>({
		name: "spec_grep",
		label: "Spec Grep",
		description:
			"Search the project's spec-graph: regex or substring match within spec files (files whose frontmatter carries `id` + `type`), optionally narrowed by metadata (type / tag / parent / depends-on). Returns path:line matches with a snippet. Read a matched file's body with the normal read tool.",
		promptSnippet:
			"spec_grep — search the project's spec-graph by content (narrowable by metadata); reach for it before grep/read when exploring or planning.",
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
					...(params.limit !== undefined ? { limit: params.limit } : {}),
				});
			} catch (err) {
				// A malformed regex (`regex: true`) is the only way grepSpecs throws — surface it, don't crash.
				return errorResult(`Invalid search pattern: ${(err as Error).message}`);
			}
			const { matches, truncated } = result;
			const header =
				matches.length === 0
					? "No matches."
					: `${matches.length} match(es)${truncated ? " (truncated)" : ""}:`;
			const body = matches.map((m) => `${m.path}:${m.line}: ${m.snippet}`).join("\n");
			return textResult(`${header}\n${body}`.trimEnd(), { matches, truncated });
		},
	});
}
