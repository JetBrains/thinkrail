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

export function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key];
	return typeof v === "string" ? v : "";
}

export function numArg(args: Record<string, unknown>, key: string): number | null {
	const v = args[key];
	return typeof v === "number" ? v : null;
}

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
