import type {
	CodeFileOutlineResponse,
	CodeFindReferencesResponse,
	CodeGotoDefinitionResponse,
	CodeSymbolSearchResponse,
	LspOutlineNode,
} from "./wire";

function notes(items: readonly string[]): string {
	return items.length > 0 ? `\n\nNote: ${items.join("; ")}` : "";
}

function indentBlock(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

export function formatSymbolSearch(query: string, result: CodeSymbolSearchResponse): string {
	if (result.hits.length === 0) {
		return `No symbols matching "${query}".${notes(result.notes)}`;
	}
	const via = result.source === "lsp" ? "language server" : "text search";
	const body = result.hits
		.map((hit) => {
			const where = hit.container ? `${hit.container}.${hit.name}` : hit.name;
			const head = `${hit.path}:${hit.line}  ${hit.kind} ${where}`;
			return hit.preview ? `${head}\n${indentBlock(hit.preview, "    ")}` : head;
		})
		.join("\n");
	return `${result.hits.length} match(es) for "${query}" via ${via}:\n${body}${notes(result.notes)}`;
}

export function formatReferences(result: CodeFindReferencesResponse): string {
	if (result.total === 0) return `No references to ${result.symbol}.${notes(result.notes)}`;
	const body = result.groups
		.map((group) => {
			const sites = group.references
				.map((site) => `  ${group.path}:${site.line}:${site.column}  ${site.snippet}`)
				.join("\n");
			return `${group.path} (${group.count} reference${group.count === 1 ? "" : "s"})\n${sites}`;
		})
		.join("\n");
	return `${result.total} reference(s) to ${result.symbol}:\n${body}${notes(result.notes)}`;
}

export function formatDefinition(result: CodeGotoDefinitionResponse): string {
	if (result.definitions.length === 0) {
		return `No definition found for ${result.symbol}.${notes(result.notes)}`;
	}
	const body = result.definitions
		.map(
			(hit) =>
				`${hit.path}:${hit.line}:${hit.column}  ${hit.signature}\n` +
				`lines ${hit.blockStartLine}-${hit.blockEndLine}:\n${indentBlock(hit.block, "    ")}`,
		)
		.join("\n\n");
	return `${body}${notes(result.notes)}`;
}

function outlineLines(nodes: readonly LspOutlineNode[], depth: number): string[] {
	return nodes.flatMap((node) => [
		`${"  ".repeat(depth)}${node.kind} ${node.name}  ${node.startLine}..${node.endLine}`,
		...outlineLines(node.children, depth + 1),
	]);
}

export function formatOutline(result: CodeFileOutlineResponse): string {
	if (result.nodes.length === 0) return `No symbols in ${result.path}.${notes(result.notes)}`;
	return `${result.path}\n${outlineLines(result.nodes, 1).join("\n")}${notes(result.notes)}`;
}
