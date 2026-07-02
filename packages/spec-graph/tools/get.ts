// spec_get — one node by id: frontmatter, resolved links, and path. No body (read it with `read`).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Frontmatter, LINK_KINDS, type LinkKind, linkTargets } from "../core/index.ts";
import { errorResult, getIndex, textResult } from "./shared.ts";

const parameters = Type.Object({
	id: Type.String({ description: "The spec id to look up." }),
});

/** A resolved link target: the id and whether a node exists for it. */
interface ResolvedLink {
	kind: LinkKind;
	target: string;
	path: string | null;
}

interface GetDetails {
	id: string;
	type: string;
	title: string | undefined;
	path: string;
	frontmatter: Frontmatter;
	links: ResolvedLink[];
	reverseLinks: ResolvedLink[];
}

export function registerSpecGet(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, GetDetails | { error: string }>({
		name: "spec_get",
		label: "Spec Get",
		description:
			"Get one spec node by id: its frontmatter, path, and resolved links (forward + reverse edges across parent/depends-on/references/implements). Returns no prose body — read the file at the returned path with the read tool.",
		promptSnippet:
			"spec_get — look up one spec by id: its frontmatter, resolved links, and path (read the body with `read`).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const graph = getIndex(ctx.cwd).graph();
			const node = graph.nodes.get(params.id);
			if (!node) return errorResult(`No spec with id "${params.id}".`);

			const links: ResolvedLink[] = [];
			for (const kind of LINK_KINDS) {
				for (const target of linkTargets(node.frontmatter, kind)) {
					links.push({ kind, target, path: graph.nodes.get(target)?.path ?? null });
				}
			}
			const reverseLinks: ResolvedLink[] = [];
			for (const kind of LINK_KINDS) {
				for (const source of graph.reverse[kind].get(params.id) ?? []) {
					reverseLinks.push({ kind, target: source, path: graph.nodes.get(source)?.path ?? null });
				}
			}

			const details: GetDetails = {
				id: node.id,
				type: node.type,
				title: node.title,
				path: node.path,
				frontmatter: node.frontmatter,
				links,
				reverseLinks,
			};

			const fmtLink = (l: ResolvedLink) =>
				`  ${l.kind} -> ${l.target}${l.path ? ` (${l.path})` : " (missing)"}`;
			const text = [
				`${node.id} [${node.type}]${node.title ? ` — ${node.title}` : ""}`,
				`path: ${node.path}`,
				links.length ? `links:\n${links.map(fmtLink).join("\n")}` : "links: (none)",
				reverseLinks.length
					? `referenced by:\n${reverseLinks.map(fmtLink).join("\n")}`
					: "referenced by: (none)",
			].join("\n");

			return textResult(text, details);
		},
	});
}
