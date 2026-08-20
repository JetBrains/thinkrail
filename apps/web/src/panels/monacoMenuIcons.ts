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

const svg = (icon: LucideIcon) => renderToStaticMarkup(createElement(icon, { size: 14 }));

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

const MENU_CSS =
	".editor-menu-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;margin:0 8px 0 2px;flex-shrink:0;color:inherit}";

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

function decorateOpenMenus(): void {
	for (const root of menuRoots()) {
		const rows = root.querySelectorAll<HTMLElement>(
			".monaco-menu .action-menu-item:not([data-tr-icons])",
		);
		if (rows.length === 0) continue;
		ensureStyle(root);
		for (const row of rows) {
			row.dataset.trIcons = "true";
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

export function decorateEditorContextMenus(
	codeEditor: monaco.editor.ICodeEditor,
): monaco.IDisposable {
	return codeEditor.onContextMenu(() => {
		requestAnimationFrame(decorateOpenMenus);
		setTimeout(decorateOpenMenus, 80);
	});
}
