import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type } from "typebox";
import { BRIDGE_UNAVAILABLE, createBridge, type LspBridge } from "./bridge";
import { formatDefinition, formatOutline, formatReferences, formatSymbolSearch } from "./format";
import type {
	CodeFileOutlineResponse,
	CodeFindReferencesResponse,
	CodeGotoDefinitionResponse,
	CodeSymbolSearchResponse,
} from "./wire";

const FILE_PATH = Type.String({
	description: "File path, relative to the workspace root (or absolute inside it).",
});
const SYMBOL_NAME = Type.Optional(
	Type.String({
		description:
			"Name of the symbol in `file_path`, e.g. `parseConfig` or `Server.start`. Preferred over `line`.",
	}),
);
const LINE = Type.Optional(
	Type.Integer({
		minimum: 1,
		maximum: 4_294_967_295,
		description: "1-indexed line of the symbol; use when `symbol_name` is ambiguous.",
	}),
);
const COLUMN = Type.Optional(
	Type.Integer({
		minimum: 1,
		maximum: 4_294_967_295,
		description: "1-indexed column, used with `line`.",
	}),
);

export const SymbolSearchSchema = Type.Object({
	query: Type.String({ description: "Symbol name or part of one (case-insensitive)." }),
	kind_filter: Type.Optional(
		Type.String({
			description:
				"Limit to one kind: function, class, struct, interface, enum, type, variable, module, method.",
		}),
	),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 100, description: "Maximum matches (default 20)." }),
	),
});

export const FindReferencesSchema = Type.Object({
	file_path: FILE_PATH,
	symbol_name: SYMBOL_NAME,
	line: LINE,
	column: COLUMN,
	include_declaration: Type.Optional(
		Type.Boolean({ description: "Also list the declaration itself (default false)." }),
	),
});

export const GotoDefinitionSchema = Type.Object({
	file_path: FILE_PATH,
	symbol_name: SYMBOL_NAME,
	line: LINE,
	column: COLUMN,
});

export const FileOutlineSchema = Type.Object({ file_path: FILE_PATH });

const PREFER =
	"Prefer this over grep or reading whole files when navigating code. " +
	"Lines are 1-indexed and paths workspace-relative, so `path:line` can be used directly in read/edit calls.";

interface ToolSpec<S extends TSchema, R> {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	parameters: S;
	operation: "symbol_search" | "find_references" | "goto_definition" | "file_outline";
	format: (params: Static<S>, result: R) => string;
}

/** Tool parameters are snake_case; the shell's bridge reads camelCase. */
export function toBridgeParams(params: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
	}
	return out;
}

function tool<S extends TSchema, R>(bridge: LspBridge | null, spec: ToolSpec<S, R>) {
	return {
		name: spec.name,
		label: spec.label,
		description: spec.description,
		promptSnippet: spec.promptSnippet,
		parameters: spec.parameters,
		async execute(
			_toolCallId: string,
			params: Static<S>,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string },
		) {
			if (!bridge) throw new Error(BRIDGE_UNAVAILABLE);
			const payload = toBridgeParams(params as Record<string, unknown>);
			const result = await bridge<R>(spec.operation, ctx.cwd, payload, signal);
			return {
				content: [{ type: "text" as const, text: spec.format(params, result) }],
				details: result,
			};
		},
	};
}

/**
 * The four read-only code-navigation tools. Pi tools run without an approval prompt (only MCP
 * tools are gated, by their `readOnlyHint`), and these never write.
 */
export function createLspSearchExtension(
	bridge: LspBridge | null = createBridge(),
): ExtensionFactory {
	return (pi: ExtensionAPI): void => {
		pi.registerTool(
			tool<typeof SymbolSearchSchema, CodeSymbolSearchResponse>(bridge, {
				name: "code_symbol_search",
				label: "Symbol search",
				description:
					"Find classes, functions, structs, interfaces and types across the workspace through its language server " +
					"(falls back to a gitignore-aware text search when none is installed). Returns `path:line`, kind and a short preview, exact and prefix matches first. " +
					PREFER,
				promptSnippet:
					"Find where a class/function/type is defined across the workspace (semantic, with text fallback) before grepping.",
				parameters: SymbolSearchSchema,
				operation: "symbol_search",
				format: (params, result) => formatSymbolSearch(params.query, result),
			}),
		);
		pi.registerTool(
			tool<typeof FindReferencesSchema, CodeFindReferencesResponse>(bridge, {
				name: "code_find_references",
				label: "Find references",
				description:
					"Find every call site and usage of a symbol, grouped by file with a one-line snippet. " +
					"Locate the symbol in `file_path` by `symbol_name` or by `line` (+ optional `column`). " +
					PREFER,
				promptSnippet:
					"List all usages of a symbol by name or line, grouped by file; use before changing a signature.",
				parameters: FindReferencesSchema,
				operation: "find_references",
				format: (_params, result) => formatReferences(result),
			}),
		);
		pi.registerTool(
			tool<typeof GotoDefinitionSchema, CodeGotoDefinitionResponse>(bridge, {
				name: "code_goto_definition",
				label: "Go to definition",
				description:
					"Jump to the definition of a symbol used in `file_path` (by `symbol_name` or `line`) and return its location, signature and enclosing definition block. " +
					PREFER,
				promptSnippet:
					"Jump to a symbol's definition and see its signature and body without opening the file.",
				parameters: GotoDefinitionSchema,
				operation: "goto_definition",
				format: (_params, result) => formatDefinition(result),
			}),
		);
		pi.registerTool(
			tool<typeof FileOutlineSchema, CodeFileOutlineResponse>(bridge, {
				name: "code_file_outline",
				label: "File outline",
				description:
					"List the functions, classes and methods of a file as a tree with `start..end` line ranges, so a large file can be inspected without reading every line. " +
					PREFER,
				promptSnippet:
					"Outline a file's symbols and line ranges before reading a large file; then read only the range you need.",
				parameters: FileOutlineSchema,
				operation: "file_outline",
				format: (_params, result) => formatOutline(result),
			}),
		);
	};
}
