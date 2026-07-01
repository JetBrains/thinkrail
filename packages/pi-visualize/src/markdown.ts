import type { ComparisonOption } from "./schema.ts";

/**
 * Tier-1 fallback rendering: a plain-markdown representation returned as the tool's `content`. Any pi
 * host (TUI, piped output, a UI without our renderer) shows something readable; the model also sees a
 * confirmation of what it emitted. Rich rendering (mermaid → SVG, styled cards) is layered on top by
 * host-specific renderers keyed to the tool name.
 */

/** A fenced ```mermaid block, optionally preceded by a title heading. */
export function mermaidFence(title: string | undefined, mermaid: string): string {
	const body = `\`\`\`mermaid\n${mermaid.trim()}\n\`\`\``;
	return title ? `### ${title}\n\n${body}` : body;
}

/** A sectioned markdown rendering of an options comparison. */
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
