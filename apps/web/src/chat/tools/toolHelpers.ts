// Pure helpers shared by the built-in tool renderers: pull text out of an `unknown` tool result, read
// args defensively, and infer a shiki language from a file path. Kept tiny + side-effect-free so the
// renderers stay small and these are unit-testable on their own.

/** Best-effort plain text from a tool's `result` (an AgentToolResult-shaped value, typed `unknown`). */
export function resultText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (typeof result === "object" && "content" in result) {
		const content = (result as { content: unknown }).content;
		if (Array.isArray(content)) {
			return content
				.filter(
					(c): c is { type: "text"; text: string } =>
						typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
				)
				.map((c) => c.text)
				.join("");
		}
	}
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
}

/** Read a string arg, or "" if missing / not a string. */
export function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key];
	return typeof v === "string" ? v : "";
}

/** Read a number arg, or null if missing / not a number. */
export function numArg(args: Record<string, unknown>, key: string): number | null {
	const v = args[key];
	return typeof v === "number" ? v : null;
}

/**
 * Pull the old/new text out of an `edit` tool call's args. pi's edit tool nests replacements in an
 * `edits: [{ oldText, newText }, …]` array (the primary shape the model emits); we join the entries for
 * display. Falls back to a legacy top-level `oldText`/`newText` (and `old_string`/`old` variants) that pi
 * still accepts and some providers emit. Returns empty strings when nothing matches.
 */
export function editDiffText(args: Record<string, unknown>): { oldText: string; newText: string } {
	const s = (v: unknown) => (typeof v === "string" ? v : "");
	const edits = args.edits;
	if (Array.isArray(edits) && edits.length > 0) {
		const pick = (e: unknown, a: string, b: string) => {
			const o = (e ?? {}) as Record<string, unknown>;
			return s(o[a]) || s(o[b]);
		};
		return {
			oldText: edits.map((e) => pick(e, "oldText", "old_string")).join("\n"),
			newText: edits.map((e) => pick(e, "newText", "new_string")).join("\n"),
		};
	}
	return {
		oldText: s(args.oldText) || s(args.old_string) || s(args.old),
		newText: s(args.newText) || s(args.new_string) || s(args.new),
	};
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

/** The last path segment, e.g. "/a/b/App.tsx" -> "App.tsx". */
function fileName(path: string): string {
	const parts = normalizePath(path).split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

function trimTrailingSlashes(path: string): string {
	return path.replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

/**
 * Display a file path relative to the workspace/project root when possible. Tool args may already be
 * relative; absolute paths are trimmed only when the host-provided root matches.
 */
export function projectRelativePath(path: string, workspaceRoot?: string | undefined): string {
	const normalized = normalizePath(path).replace(/^\.\/+/, "");
	if (!normalized || !isAbsolutePath(normalized)) return normalized;

	const root = workspaceRoot ? trimTrailingSlashes(normalizePath(workspaceRoot)) : "";
	if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
		return normalized.slice(root.length).replace(/^\/+/, "") || fileName(normalized);
	}

	return normalized;
}

/** A shiki language id inferred from a file extension (falls back to "" -> plain text). */
export function languageFromPath(path: string): string {
	const ext = path.split(".").at(-1)?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		mjs: "javascript",
		cjs: "javascript",
		json: "json",
		py: "python",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		css: "css",
		html: "html",
		md: "markdown",
		yml: "yaml",
		yaml: "yaml",
	};
	return map[ext] ?? "";
}
