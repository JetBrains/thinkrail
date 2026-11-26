import { afterAll, afterEach, beforeAll } from "bun:test";
import type { LocalKeyEvent } from "@thinkrail/ui/local-keys";
import { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WalkRect } from "./settingsWalk";

const FORM_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

export const dom = {
	focused: null as FakeNode | null,
	log: [] as string[],
};

export function resetDom(): void {
	dom.focused = null;
	dom.log = [];
}

export class FakeNode {
	readonly tagName: string;
	readonly attributes: Map<string, string>;
	readonly children: FakeNode[];
	parentElement: FakeNode | null = null;
	hidden = false;
	rect: WalkRect | null = null;
	selectionStart: number | null = null;
	selectionEnd: number | null = null;
	onClick: (() => void) | null = null;

	constructor(tag: string, attributes: Record<string, string>, children: FakeNode[]) {
		this.tagName = tag.toUpperCase();
		this.attributes = new Map(Object.entries(attributes));
		this.children = children;
		for (const child of children) child.parentElement = this;
	}

	get root(): FakeNode {
		return this.parentElement ? this.parentElement.root : this;
	}
	get ownerDocument() {
		return { activeElement: dom.focused };
	}
	get value(): string {
		return this.attributes.get("value") ?? "";
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
	hasAttribute(name: string) {
		return this.attributes.has(name);
	}
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	removeAttribute(name: string) {
		this.attributes.delete(name);
	}
	matches(selector: string): boolean {
		return selector.split(",").some((part) => matchesCompound(this, part.trim()));
	}
	closest(selector: string): FakeNode | null {
		if (this.matches(selector)) return this;
		return this.parentElement ? this.parentElement.closest(selector) : null;
	}
	descendants(): FakeNode[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}
	querySelectorAll(selector: string): FakeNode[] {
		return this.descendants().filter((node) => node.matches(selector));
	}
	querySelector(selector: string): FakeNode | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	contains(other: FakeNode | null): boolean {
		for (let node = other; node; node = node.parentElement) if (node === this) return true;
		return false;
	}
	compareDocumentPosition(other: FakeNode): number {
		const order = [this.root, ...this.root.descendants()];
		return order.indexOf(other) > order.indexOf(this) ? 4 : 2;
	}
	checkVisibility(): boolean {
		return !this.hidden && (this.parentElement ? this.parentElement.checkVisibility() : true);
	}
	focus() {
		if (!this.checkVisibility() || this.matches(":disabled")) return;
		dom.focused = this;
		dom.log.push(`focus ${nameOf(this)}`);
	}
	click() {
		dom.log.push(`click ${nameOf(this)}`);
		this.onClick?.();
	}
	select() {
		this.selectionStart = 0;
		this.selectionEnd = this.value.length;
		dom.log.push(`select ${nameOf(this)}`);
	}
	getBoundingClientRect(): WalkRect {
		return this.rect ?? { top: 0, bottom: 0, left: 0 };
	}
	scrollIntoView() {
		dom.log.push(`scroll ${nameOf(this)}`);
	}
}

function matchesCompound(node: FakeNode, compound: string): boolean {
	if (/[\s>]/.test(compound)) return false;
	let rest = compound;
	const tag = /^[a-z]+/i.exec(rest)?.[0];
	if (tag) {
		if (node.tagName !== tag.toUpperCase()) return false;
		rest = rest.slice(tag.length);
	}
	while (rest.length > 0) {
		const attribute = /^\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/.exec(rest);
		const not = /^:not\(([^)]*\)?)\)/.exec(rest);
		const disabled = /^:disabled/.exec(rest);
		if (attribute) {
			const value = node.getAttribute(attribute[1] ?? "");
			if (value === null) return false;
			const expected = attribute[2]?.replace(/\\(.)/g, "$1");
			if (expected !== undefined && value !== expected) return false;
			rest = rest.slice(attribute[0].length);
		} else if (not) {
			if (matchesCompound(node, not[1] ?? "")) return false;
			rest = rest.slice(not[0].length);
		} else if (disabled) {
			if (!(FORM_TAGS.has(node.tagName) && node.hasAttribute("disabled"))) return false;
			rest = rest.slice(disabled[0].length);
		} else {
			throw new Error(`fake DOM: unsupported selector ${compound}`);
		}
	}
	return true;
}

export const h = (tag: string, attributes: Record<string, string> = {}, ...children: FakeNode[]) =>
	new FakeNode(tag, attributes, children);

export const row = (id: string, ...children: FakeNode[]) =>
	h("div", { "data-setting-row": id, "data-name": id, tabindex: "-1" }, ...children);
export const holder = (id: string, ...children: FakeNode[]) =>
	h("div", { "data-setting-row": id }, ...children);
export const control = (...children: FakeNode[]) =>
	h("div", { "data-setting-control": "" }, ...children);
export const button = (name: string, attributes: Record<string, string> = {}) =>
	h("button", { "data-name": name, tabindex: "0", ...attributes });
export const reset = (name: string) => button(name, { "data-setting-reset": "" });
export const toggle = (name: string) => button(name, { role: "switch" });
export const field = (name: string, value = "") =>
	h("input", { type: "text", "data-name": name, tabindex: "0", value });
export const choice = (name: string, ...options: string[]) =>
	h(
		"div",
		{ role: "listbox", "data-name": name },
		...options.map((option, index) =>
			h("button", {
				role: "option",
				"data-name": option,
				tabindex: index === 0 ? "0" : "-1",
			}),
		),
	);
export const item = (name: string, ...children: FakeNode[]) =>
	h("li", { role: "treeitem", "data-name": name, tabindex: "-1" }, ...children);
export const named = (root: FakeNode, name: string) => {
	const node = root.querySelector(`[data-name="${name}"]`);
	if (!node) throw new Error(`fake DOM: no ${name}`);
	return node;
};
export const nameOf = (node: FakeNode | null | undefined) =>
	node?.getAttribute("data-name") ?? null;

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link", "area", "col", "wbr"]);
const ENTITIES: Readonly<Record<string, string>> = {
	"&quot;": '"',
	"&#x27;": "'",
	"&#39;": "'",
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
};

export function parseMarkup(markup: string): FakeNode {
	const stack: { tag: string; attributes: Record<string, string>; children: FakeNode[] }[] = [
		{ tag: "div", attributes: {}, children: [] },
	];
	const close = () => {
		const open = stack.pop();
		const parent = stack.at(-1);
		if (!open || !parent) throw new Error("fake DOM: unbalanced markup");
		const node = new FakeNode(open.tag, open.attributes, open.children);
		node.hidden = "hidden" in open.attributes;
		parent.children.push(node);
	};
	for (const [tag] of markup.matchAll(/<[^>]+>/g)) {
		if (tag.startsWith("</")) {
			close();
			continue;
		}
		const name = /^<([\w-]+)/.exec(tag)?.[1]?.toLowerCase() ?? "div";
		const attributes: Record<string, string> = {};
		for (const [, key = "", value = ""] of tag
			.slice(name.length + 1)
			.matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) {
			attributes[key.toLowerCase()] = value.replace(
				/&(quot|#x27|#39|lt|gt|amp);/g,
				(entity) => ENTITIES[entity] ?? entity,
			);
		}
		stack.push({ tag: name, attributes, children: [] });
		if (VOID_TAGS.has(name) || tag.endsWith("/>")) close();
	}
	if (stack.length !== 1) throw new Error("fake DOM: unbalanced markup");
	return new FakeNode("div", {}, stack[0]?.children ?? []);
}

export function press(code: string, key = code, init: Partial<LocalKeyEvent> = {}): LocalKeyEvent {
	return {
		code,
		key,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		isComposing: false,
		keyCode: 0,
		target: null,
		...init,
	};
}

export function findProps<P extends object>(
	node: ReactNode,
	match: (props: P) => boolean,
): P | null {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findProps(child, match);
			if (found) return found;
		}
		return null;
	}
	if (!isValidElement<P & { children?: ReactNode }>(node)) return null;
	return match(node.props) ? node.props : findProps(node.props.children, match);
}

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };

// react-dom only touches these members when a tree renders no host elements.
export function headlessReact(): { mount: () => (node: ReactNode) => Promise<void> } {
	const globals = globalThis as ReactGlobals;
	const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };
	beforeAll(() => {
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		globals.window = {
			event: undefined,
			HTMLIFrameElement: class {},
			document: { activeElement: null },
		};
	});
	const mounted: Root[] = [];
	afterEach(async () => {
		const roots = mounted.splice(0);
		await act(async () => {
			for (const root of roots) root.unmount();
		});
	});
	afterAll(() => {
		globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
		globals.window = saved.window;
	});
	const noop = () => {};
	const container = () =>
		({
			nodeType: 1,
			nodeName: "DIV",
			tagName: "DIV",
			namespaceURI: "http://www.w3.org/1999/xhtml",
			textContent: "",
			addEventListener: noop,
			removeEventListener: noop,
			ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
		}) as unknown as Element;
	return {
		mount: () => {
			const root = createRoot(container());
			mounted.push(root);
			return (node) => act(async () => root.render(node));
		},
	};
}
