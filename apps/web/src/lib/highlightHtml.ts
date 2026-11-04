export const HIGHLIGHT_PRE_END = "</code></pre>";

const TAIL_OPEN = "<span data-highlight-tail>";

export function escapeHtml(text: string) {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export interface HighlightLines {
	open: string;
	from: number;
	lines: string[];
	tail: string;
}

export function assembleHighlight(open: string, lines: readonly string[], tail: string) {
	const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
	return `${open}${body}${TAIL_OPEN}${tail}</span>${HIGHLIGHT_PRE_END}`;
}

type HighlightPatch =
	| { kind: "replace"; stable: string | null }
	| { kind: "append"; stable: string; added: string };

export function planHighlightPatch(stable: string | null, html: string): HighlightPatch {
	const tailAt = html.lastIndexOf(TAIL_OPEN);
	if (tailAt < 0 || !html.endsWith(HIGHLIGHT_PRE_END)) return { kind: "replace", stable: null };
	const next = html.slice(0, tailAt);
	if (stable === null || !next.startsWith(stable)) return { kind: "replace", stable: next };
	return {
		kind: "append",
		stable: next,
		added: html.slice(stable.length, -HIGHLIGHT_PRE_END.length),
	};
}

export interface HighlightDom {
	stable: string | null;
}

export function applyHighlightHtml(host: HTMLElement, dom: HighlightDom, html: string) {
	const patch = planHighlightPatch(dom.stable, html);
	const code = patch.kind === "append" ? host.querySelector("code") : null;
	if (patch.kind === "replace" || !code) {
		host.innerHTML = html;
		dom.stable = patch.stable;
		return;
	}
	let node = code.lastChild;
	while (node && !(node instanceof Element && node.hasAttribute("data-highlight-tail"))) {
		const previous = node.previousSibling;
		node.remove();
		node = previous;
	}
	node?.remove();
	code.insertAdjacentHTML("beforeend", patch.added);
	dom.stable = patch.stable;
}
