// Lucide icons for Monaco's context menu (see panels/SPEC.md). Monaco's STANDALONE menu renders
// label-only rows — an action's icon (`action.class`) is a workbench feature `addAction` can't reach —
// so the open menu is decorated in place: every row gets an icon slot (labels stay aligned), and rows
// whose English label we know get the same lucide glyph the rest of the UI uses. Decoration is
// defensive by construction: an unmapped or restructured row is simply left label-only, exactly what
// Monaco renders today, so a Monaco bump can only lose icons, never break the menu.

import {
	ArrowUpRight,
	Braces,
	ClipboardPaste,
	Command,
	Copy,
	Eye,
	Link2,
	type LucideIcon,
	MessageSquarePlus,
	Scissors,
} from "lucide-react";
import type * as monaco from "monaco-editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Rendered to static markup once — the same icons every React surface uses, never hand-inlined
// (the reviewWidgets pattern: Monaco owns the menu's DOM, React can't reach in).
const svg = (icon: LucideIcon) => renderToStaticMarkup(createElement(icon, { size: 14 }));

/** Menu label (trailing `…`/`...` stripped) → lucide glyph. Cut/Paste ride along for the day an
 * editable surface shows them; unknown labels keep an EMPTY slot so the column stays aligned. */
const ICONS = new Map<string, string>([
	["Comment on selection", svg(MessageSquarePlus)],
	["Copy", svg(Copy)],
	["Cut", svg(Scissors)],
	["Paste", svg(ClipboardPaste)],
	["Go to Definition", svg(ArrowUpRight)],
	["Go to References", svg(Link2)],
	["Go to Symbol", svg(Braces)],
	["Peek", svg(Eye)],
	["Command Palette", svg(Command)],
]);

// Injected into every root a menu renders in. Monaco mounts its context view inside an OPEN shadow
// root (`.shadow-root-host` in the editor's dom node), which page stylesheets can't reach — so the
// slot's rule travels with the decoration. No colors of its own: `currentColor` follows the row's own
// foreground through Monaco's hover/disabled states, whatever the theme.
const MENU_CSS =
	".editor-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;margin:0 8px 0 2px;flex-shrink:0;color:inherit}";

/** The document itself plus every open Monaco shadow root — everywhere a `.monaco-menu` can live. */
function menuRoots(): (Document | ShadowRoot)[] {
	const roots: (Document | ShadowRoot)[] = [document];
	for (const host of document.querySelectorAll<HTMLElement>(".shadow-root-host")) {
		if (host.shadowRoot) roots.push(host.shadowRoot);
	}
	return roots;
}

function ensureStyle(root: Document | ShadowRoot): void {
	const parent = root instanceof Document ? root.head : root;
	if (parent.querySelector("style[data-editor-menu-icons]")) return;
	const style = document.createElement("style");
	style.dataset.editorMenuIcons = "true";
	style.textContent = MENU_CSS;
	parent.appendChild(style);
}

/**
 * Decorate every currently-open Monaco menu row that hasn't been decorated yet. Idempotent (rows are
 * stamped), so it can run on every open/re-render. Submenu popups (Peek ▸) mount later on hover and
 * stay undecorated — a separate box, uniform within itself.
 */
function decorateOpenMenus(): void {
	for (const root of menuRoots()) {
		const rows = root.querySelectorAll<HTMLElement>(
			".monaco-menu .action-menu-item:not([data-tr-icons])",
		);
		if (rows.length === 0) continue;
		ensureStyle(root);
		for (const row of rows) {
			row.dataset.trIcons = "true";
			// A separator renders as a presentation row without a label — leave it untouched.
			const label = row.querySelector<HTMLElement>(":scope > .action-label");
			if (!label?.textContent) continue;
			const holder = document.createElement("span");
			holder.className = "editor-menu-icon";
			holder.ariaHidden = "true";
			const icon = ICONS.get(label.textContent.trim().replace(/[.…]+$/u, ""));
			if (icon) holder.innerHTML = icon;
			label.before(holder);
		}
	}
}

/**
 * Install the decoration on one editor: its context menu renders right after the `onContextMenu`
 * event, so the pass runs on the next frame (plus one delayed retry — the menu mounts through
 * Monaco's own scheduling and a slow frame must not leave it bare). Returns the listener disposable.
 */
export function decorateEditorContextMenus(
	codeEditor: monaco.editor.ICodeEditor,
): monaco.IDisposable {
	return codeEditor.onContextMenu(() => {
		requestAnimationFrame(decorateOpenMenus);
		setTimeout(decorateOpenMenus, 80);
	});
}
