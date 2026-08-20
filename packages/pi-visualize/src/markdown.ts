import type { ComparisonOption } from "./schema.ts";

export function mermaidFence(title: string | undefined, mermaid: string): string {
	const body = `\`\`\`mermaid\n${mermaid.trim()}\n\`\`\``;
	return title ? `### ${title}\n\n${body}` : body;
}

export function comparisonMarkdown(title: string | undefined, options: ComparisonOption[]): string {
	const blocks: string[] = [];
	if (title) blocks.push(`## ${title}`);

	for (const opt of options) {
		const parts: string[] = [];
		parts.push(`### ${opt.name}${opt.recommended ? " — ✅ Recommended" : ""}`);
		if (opt.description) parts.push(opt.description);
		if (opt.pros && opt.pros.length > 0) {
			parts.push(["**Pros:**", ...opt.pros.map((p) => `- ${p}`)].join("\n"));
		}
		if (opt.cons && opt.cons.length > 0) {
			parts.push(["**Cons:**", ...opt.cons.map((c) => `- ${c}`)].join("\n"));
		}
		if (opt.mermaid && opt.mermaid.trim() !== "") {
			parts.push(mermaidFence(undefined, opt.mermaid));
		}
		blocks.push(parts.join("\n\n"));
	}

	return blocks.join("\n\n");
}
