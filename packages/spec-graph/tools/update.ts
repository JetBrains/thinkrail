// spec_update — frontmatter only: set/remove scalar fields and add/remove list entries. Never touches
// prose. The frontmatter is edited in place on a live YAML Document (via core's updateFrontmatterText),
// so comments and any non-dialect fields survive the round-trip and the file keeps its line endings.

import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FIELDS, type FrontmatterEdit, updateFrontmatterText } from "../core/index.ts";
import { errorResult, getIndex, textResult } from "./shared.ts";

// Keyed by the frontmatter list-field names via FIELDS (single-sourced), so the schema and the core
// write path move together when a list field is renamed. Covers the DAG links (depends-on/references/
// implements) and the metadata lists (covers/tags) — every list field the schema owns.
const listGroup = Type.Object({
	[FIELDS.dependsOn]: Type.Optional(Type.Array(Type.String())),
	[FIELDS.references]: Type.Optional(Type.Array(Type.String())),
	[FIELDS.implements]: Type.Optional(Type.Array(Type.String())),
	[FIELDS.covers]: Type.Optional(Type.Array(Type.String())),
	[FIELDS.tags]: Type.Optional(Type.Array(Type.String())),
});

const parameters = Type.Object({
	id: Type.String({ description: "Id of the spec to update." }),
	set: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description:
				"Scalar frontmatter fields to set/overwrite (e.g. title, status, parent). For list fields (depends-on/references/implements/covers/tags) use addList/removeList.",
		}),
	),
	remove: Type.Optional(
		Type.Array(Type.String(), { description: "Frontmatter field names to remove entirely." }),
	),
	addList: Type.Optional(listGroup),
	removeList: Type.Optional(listGroup),
});

export function registerSpecUpdate(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { id: string; path: string } | { error: string }>({
		name: "spec_update",
		label: "Spec Update",
		description:
			"Edit a spec's frontmatter only (never its prose): set/overwrite scalar fields, remove fields, and add/remove entries in the list fields (depends-on/references/implements/covers/tags). Comments and any non-dialect fields are preserved. Prose is edited with the write/edit tools.",
		promptSnippet:
			"spec_update — edit a spec's frontmatter only (scalar fields + list entries); never its prose.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const index = getIndex(ctx.cwd);
			const record = index.recordForId(params.id);
			if (!record) return errorResult(`No spec with id "${params.id}".`);

			// Work off the scan's cached read (no second disk read). A scanned spec always has frontmatter;
			// the lossless edit re-parses that cached text into a live Document and mutates it in place.
			const { abs, rel: path, content: cachedText } = record;
			const edit: FrontmatterEdit = {
				set: params.set,
				remove: params.remove,
				addList: params.addList,
				removeList: params.removeList,
			};
			const result = updateFrontmatterText(cachedText, edit);
			if ("error" in result) return errorResult(result.error);
			try {
				writeFileSync(abs, result.content, "utf8");
			} catch (err) {
				return errorResult(`Failed to write ${path}: ${(err as Error).message}`);
			}
			return textResult(`Updated frontmatter of ${path} (id: ${params.id}).`, {
				id: params.id,
				path,
			});
		},
	});
}
