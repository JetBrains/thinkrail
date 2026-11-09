function normalizeFrontmatterText(value: string): string {
	const withoutBom = value.startsWith("\uFEFF") ? value.slice(1) : value;
	return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function stripFrontmatter(content: string): string {
	const normalized = normalizeFrontmatterText(content);
	if (!normalized.startsWith("---")) return normalized;
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;
	return normalized.slice(endIndex + 4).trim();
}

export function assembleTemplate(description: string, argumentHint: string, body: string): string {
	const lines: string[] = [];
	const d = description.trim();
	const a = argumentHint.trim();
	if (d) lines.push(`description: ${JSON.stringify(d)}`);
	if (a) lines.push(`argument-hint: ${JSON.stringify(a)}`);
	if (lines.length === 0) {
		return normalizeFrontmatterText(body).startsWith("---") ? `---\n---\n\n${body}` : body;
	}
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
