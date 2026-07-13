import type * as monaco from "monaco-editor";
import type { SelectionTarget } from "./types";

/** hast node shape we touch (rehype provides `position` from the remark parse). */
interface HastNode {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	position?: { start: { line: number }; end: { line: number } };
	children?: HastNode[];
}

/**
 * Rehype plugin: stamp every block element that carries a source position with `data-md-line-start` /
 * `data-md-line-end` (1-based). The markdown selection resolver walks up from the DOM selection to these
 * to recover source line numbers — the anchor for the review overlay.
 */
export function sourceLineRehype(): (tree: HastNode) => void {
	const visit = (node: HastNode): void => {
		if (node.type === "element" && node.position && node.properties) {
			node.properties["data-md-line-start"] = node.position.start.line;
			node.properties["data-md-line-end"] = node.position.end.line;
		}
		for (const child of node.children ?? []) visit(child);
	};
	return visit;
}

/** Nearest ancestor (inclusive) carrying a stamped line range. */
function stampedAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	while (el && el !== root.parentElement) {
		if (el.hasAttribute?.("data-md-line-start")) return el;
		el = el.parentElement;
	}
	return null;
}

/**
 * Resolve the current DOM selection inside a rendered-markdown `container` to a `SelectionTarget`, or null
 * if there's no non-empty selection within it. Start/end lines come from the stamped ancestor blocks of the
 * selection's anchor and focus nodes; `rect` is the selection's bounding rect (for pill/popup placement).
 */
export function resolveMarkdownSelection(
	container: HTMLElement,
	ctx: { workspaceId: string; path: string },
): SelectionTarget | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return null;
	const text = sel.toString().trim();
	if (!text) return null;

	const startEl = stampedAncestor(range.startContainer, container);
	const endEl = stampedAncestor(range.endContainer, container);
	if (!startEl || !endEl) return null;

	const startLine = Number(startEl.getAttribute("data-md-line-start"));
	const endLine = Number(endEl.getAttribute("data-md-line-end"));
	if (!startLine || !endLine) return null;

	const r = range.getBoundingClientRect();
	return {
		workspaceId: ctx.workspaceId,
		path: ctx.path,
		text,
		startLine: Math.min(startLine, endLine),
		endLine: Math.max(startLine, endLine),
		rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
	};
}

/** Resolve a Monaco editor's current selection to a `SelectionTarget`, or null if empty. */
export function monacoSelectionTarget(
	editor: monaco.editor.IStandaloneCodeEditor,
	ctx: { workspaceId: string; path: string },
): SelectionTarget | null {
	const selection = editor.getSelection();
	const model = editor.getModel();
	if (!selection || !model || selection.isEmpty()) return null;
	const text = model.getValueInRange(selection);
	if (!text.trim()) return null;
	// Viewport rect of the selection start (for pill placement); the editor node offsets it.
	const pos = editor.getScrolledVisiblePosition(selection.getStartPosition());
	const dom = editor.getDomNode();
	const base = dom?.getBoundingClientRect() ?? { top: 0, left: 0 };
	const top = base.top + (pos?.top ?? 0);
	const left = base.left + (pos?.left ?? 0);
	return {
		workspaceId: ctx.workspaceId,
		path: ctx.path,
		text,
		startLine: selection.startLineNumber,
		endLine: selection.endLineNumber,
		rect: { top, left, bottom: top + (pos?.height ?? 18), right: left },
	};
}
