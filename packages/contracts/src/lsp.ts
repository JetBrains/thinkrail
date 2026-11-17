/**
 * Language-server (LSP) wire types shared by the desktop shell's LSP manager, the built-in
 * `lsp-search` pi extension and the web UI. All lines and columns are 1-indexed and all paths are
 * relative to the worktree, so an agent can act on a hit without converting.
 */

export const LSP_SERVER_STATUSES = ["detected", "starting", "ready", "error", "missing"] as const;

export type LspServerStatus = (typeof LSP_SERVER_STATUSES)[number];

/** Which engine produced a result: a language server, or the gitignore-aware text fallback. */
export type LspResultSource = "lsp" | "text";

export interface DetectedLspServer {
	/** Stable catalog id, e.g. `rust` or `typescript`. */
	id: string;
	language: string;
	/** Worktree-relative marker file that selected this language, e.g. `Cargo.toml`. */
	marker: string;
	/** Resolved binary; `null` when none of the candidates is installed. */
	binaryPath: string | null;
	available: boolean;
	/** Present when the server is missing: how to install it. */
	installHint: string | null;
	status: LspServerStatus;
}

export interface LspSymbolHit {
	name: string;
	/** Lowercase LSP kind (`function`, `class`, `struct`, …) or `text` for a plain mention. */
	kind: string;
	container: string | null;
	path: string;
	line: number;
	/** Two to three dedented source lines starting at `line`. */
	preview: string;
	source: LspResultSource;
}

export interface LspReferenceSite {
	line: number;
	column: number;
	snippet: string;
}

export interface LspReferenceGroup {
	path: string;
	count: number;
	references: LspReferenceSite[];
}

export interface LspDefinitionHit {
	path: string;
	line: number;
	column: number;
	signature: string;
	blockStartLine: number;
	blockEndLine: number;
	block: string;
}

export interface LspOutlineNode {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	children: LspOutlineNode[];
}

/** `code_symbol_search` */
export interface CodeSymbolSearchRequest {
	query: string;
	kind_filter?: string;
	limit?: number;
}

export interface CodeSymbolSearchResponse {
	hits: LspSymbolHit[];
	source: LspResultSource;
	notes: string[];
}

/** Locates a symbol in a file: a symbol name, or a 1-indexed line with an optional column. */
export interface CodeSymbolTarget {
	file_path: string;
	symbol_name?: string;
	line?: number;
	column?: number;
}

/** `code_find_references` */
export interface CodeFindReferencesRequest extends CodeSymbolTarget {
	include_declaration?: boolean;
}

export interface CodeFindReferencesResponse {
	symbol: string;
	total: number;
	groups: LspReferenceGroup[];
	notes: string[];
}

/** `code_goto_definition` */
export type CodeGotoDefinitionRequest = CodeSymbolTarget;

export interface CodeGotoDefinitionResponse {
	symbol: string;
	definitions: LspDefinitionHit[];
	notes: string[];
}

/** `code_file_outline` */
export interface CodeFileOutlineRequest {
	file_path: string;
}

export interface CodeFileOutlineResponse {
	path: string;
	nodes: LspOutlineNode[];
	source: LspResultSource;
	notes: string[];
}

/** Operations the desktop shell's loopback bridge serves at `POST /lsp/<operation>`. */
export const LSP_BRIDGE_OPERATIONS = [
	"detect",
	"symbol_search",
	"find_references",
	"goto_definition",
	"file_outline",
	"restart",
	"release",
] as const;

export type LspBridgeOperation = (typeof LSP_BRIDGE_OPERATIONS)[number];

/** Environment the shell sets on the host so the `lsp-search` extension can reach the bridge. */
export const LSP_BRIDGE_URL_ENV = "THINKRAIL_LSP_BRIDGE_URL";
export const LSP_BRIDGE_TOKEN_ENV = "THINKRAIL_LSP_BRIDGE_TOKEN";

export type LspBridgeReply<T> = { ok: true; result: T } | { ok: false; error: string };
