import { describe, expect, it } from "bun:test";
import {
	collectTargets,
	HINT_SELECTOR,
	type HintEnv,
	type HintRect,
	hintAction,
	measureTargets,
} from "./targets";

interface FakeInit {
	attrs?: Record<string, string>;
	rect?: HintRect;
	visible?: boolean;
	clips?: boolean;
	candidate?: boolean;
	children?: FakeElement[];
	shadow?: FakeElement[];
}

class FakeRoot {
	readonly children: FakeElement[];

	constructor(children: FakeElement[]) {
		this.children = children;
	}

	descendants(): FakeElement[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}

	querySelectorAll(selector: string): FakeElement[] {
		const all = this.descendants();
		return selector === HINT_SELECTOR ? all.filter((element) => element.candidate) : all;
	}
}

class FakeElement {
	readonly tagName: string;
	readonly attrs: Map<string, string>;
	rect: HintRect;
	readonly visible: boolean;
	readonly clips: boolean;
	readonly candidate: boolean;
	readonly children: FakeElement[];
	readonly shadowRoot: FakeRoot | null;
	parentElement: FakeElement | null = null;

	constructor(
		tagName: string,
		{
			attrs = {},
			rect = box(0, 0, 100, 20),
			visible = true,
			clips = false,
			candidate,
			children = [],
			shadow,
		}: FakeInit = {},
	) {
		this.tagName = tagName;
		this.attrs = new Map(Object.entries(attrs));
		this.rect = rect;
		this.visible = visible;
		this.clips = clips;
		this.candidate = candidate ?? tagName !== "DIV";
		this.children = children;
		this.shadowRoot = shadow ? new FakeRoot(shadow) : null;
		for (const child of children) child.parentElement = this;
	}

	descendants(): FakeElement[] {
		return this.children.flatMap((child) => [child, ...child.descendants()]);
	}

	getAttribute(name: string): string | null {
		return this.attrs.get(name) ?? null;
	}

	matches(selector: string): boolean {
		if (selector !== ":disabled") return false;
		for (let node: FakeElement | null = this; node; node = node.parentElement) {
			if (node.attrs.has("disabled") && (node === this || node.tagName === "FIELDSET")) return true;
		}
		return false;
	}

	hasAttribute(name: string): boolean {
		return this.attrs.has(name);
	}

	getBoundingClientRect(): HintRect {
		return this.rect;
	}

	checkVisibility(): boolean {
		return this.visible;
	}
}

function box(left: number, top: number, width: number, height: number): HintRect {
	return { left, top, right: left + width, bottom: top + height };
}

const el = (tag: string, init?: FakeInit) => new FakeElement(tag, init);
const div = (init?: FakeInit) => new FakeElement("DIV", init);

const env: HintEnv<FakeElement> = {
	isTextEntry: (element) =>
		["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
		element.hasAttribute("contenteditable"),
	clips: (element) => element.clips,
	viewport: { width: 1000, height: 800 },
};

function collect(...children: FakeElement[]) {
	return collectTargets(new FakeRoot(children), env);
}

describe("collectTargets", () => {
	it("labels visible controls in document order with their on-screen box", () => {
		const save = el("BUTTON", { rect: box(10, 10, 80, 24) });
		const link = el("A", { attrs: { href: "#x" }, rect: box(10, 50, 40, 16) });
		const { targets, boxes } = collect(div({ children: [save, link] }));
		expect(targets.map((target) => target.element)).toEqual([save, link]);
		expect(targets.map((target) => target.action)).toEqual(["press", "press"]);
		expect(boxes).toEqual([box(10, 10, 80, 24), box(10, 50, 40, 16)]);
	});

	it("skips what is inert, hidden, transparent, empty, off screen or disabled", () => {
		const kept = el("BUTTON");
		const { targets } = collect(
			div({ attrs: { inert: "" }, children: [el("BUTTON")] }),
			el("BUTTON", { attrs: { inert: "" } }),
			el("BUTTON", { visible: false }),
			el("BUTTON", { rect: box(10, 10, 0, 20) }),
			el("BUTTON", { rect: box(10, 900, 40, 20) }),
			el("BUTTON", { attrs: { disabled: "" } }),
			el("FIELDSET", { attrs: { disabled: "" }, candidate: false, children: [el("BUTTON")] }),
			kept,
		);
		expect(targets.map((target) => target.element)).toEqual([kept]);
	});

	it("clips a box to every scrolling ancestor and drops what is scrolled away", () => {
		const half = el("BUTTON", { rect: box(0, 90, 100, 20) });
		const gone = el("BUTTON", { rect: box(0, 150, 100, 20) });
		const { targets, boxes } = collect(
			div({ clips: true, rect: box(0, 0, 200, 100), children: [div({ children: [half, gone] })] }),
		);
		expect(targets.map((target) => target.element)).toEqual([half]);
		expect(boxes).toEqual([box(0, 90, 100, 10)]);
	});

	it("gives Monaco and xterm one label each, never their inner controls", () => {
		const editor = el("DIV", {
			attrs: { class: "monaco-editor no-user-select" },
			candidate: true,
			rect: box(0, 0, 500, 400),
			children: [el("TEXTAREA", { attrs: { class: "inputarea" } }), el("BUTTON")],
		});
		const terminal = el("DIV", {
			attrs: { class: "xterm" },
			candidate: true,
			rect: box(0, 400, 500, 200),
			children: [el("TEXTAREA", { attrs: { class: "xterm-helper-textarea" } })],
		});
		const { targets } = collect(editor, terminal);
		expect(targets.map((target) => [target.element, target.action])).toEqual([
			[editor, "widget"],
			[terminal, "widget"],
		]);
	});

	it("searches open shadow roots and applies the host's inertness and clipping", () => {
		const inside = el("BUTTON", { rect: box(5, 5, 30, 10) });
		const hidden = el("BUTTON", { rect: box(5, 5, 30, 10) });
		const clipped = el("BUTTON", { rect: box(5, 300, 30, 10) });
		const { targets } = collect(
			div({ shadow: [div({ children: [inside] })] }),
			div({ attrs: { inert: "" }, shadow: [hidden] }),
			div({ clips: true, rect: box(0, 0, 100, 100), shadow: [clipped] }),
		);
		expect(targets.map((target) => target.element)).toEqual([inside]);
	});

	it("skips a tree row's pointer duplicates but keeps the same markup outside a tree", () => {
		const row = el("BUTTON", { attrs: { role: "treeitem", tabindex: "-1" } });
		const kebab = el("BUTTON", { attrs: { "aria-hidden": "true", tabindex: "-1" } });
		const elsewhere = el("BUTTON", { attrs: { "aria-hidden": "true", tabindex: "-1" } });
		const { targets } = collect(
			div({ attrs: { role: "tree" }, children: [div({ children: [row, kebab] })] }),
			elsewhere,
		);
		expect(targets.map((target) => target.element)).toEqual([row, elsewhere]);
	});

	it("labels a zero-size review cursor proxy at its host and only focuses it", () => {
		const proxy = el("DIV", {
			attrs: { "data-review-surface": "", role: "listbox", tabindex: "0" },
			candidate: true,
			rect: box(0, 40, 300, 0),
		});
		const host = div({ rect: box(0, 40, 300, 200), children: [proxy] });
		const { targets, boxes } = collect(host);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.element).toBe(proxy);
		expect(targets[0]?.anchor).toBe(host);
		expect(targets[0]?.action).toBe("focus");
		expect(boxes).toEqual([box(0, 40, 300, 200)]);
	});

	it("re-measures on scroll, hiding a label whose element left the view", () => {
		const button = el("BUTTON", { rect: box(0, 10, 50, 20) });
		const { targets } = collect(
			div({ clips: true, rect: box(0, 0, 200, 100), children: [button] }),
		);
		button.rect = box(0, 60, 50, 20);
		expect(measureTargets(targets, env)).toEqual([box(0, 60, 50, 20)]);
		button.rect = box(0, 140, 50, 20);
		expect(measureTargets(targets, env)).toEqual([null]);
	});
});

describe("hintAction", () => {
	const action = (tag: string, attrs: Record<string, string> = {}) =>
		hintAction(el(tag, { attrs }), env.isTextEntry);

	it("presses buttons, links, button-like inputs and interactive roles", () => {
		expect(action("BUTTON")).toBe("press");
		expect(action("A", { href: "#" })).toBe("press");
		expect(action("INPUT", { type: "checkbox" })).toBe("press");
		expect(action("DIV", { role: "treeitem" })).toBe("press");
		expect(action("DIV", { role: "tab" })).toBe("press");
		expect(action("DIV", { role: "menuitem" })).toBe("press");
		expect(action("BUTTON", { role: "combobox" })).toBe("press");
	});

	it("only focuses text entry, lists, sliders and plain focus stops", () => {
		expect(action("INPUT", { type: "text" })).toBe("focus");
		expect(action("TEXTAREA")).toBe("focus");
		expect(action("DIV", { contenteditable: "true" })).toBe("focus");
		expect(action("DIV", { role: "listbox" })).toBe("focus");
		expect(action("DIV", { role: "slider" })).toBe("focus");
		expect(action("ARTICLE", { tabindex: "-1" })).toBe("focus");
		expect(action("DIV", { tabindex: "0" })).toBe("focus");
	});

	it("names the candidate selector's parts", () => {
		for (const part of [
			"[tabindex]:not([tabindex^='-'])",
			"[role='treeitem']",
			"[role='feed'] article",
			".monaco-editor",
			".xterm",
			"input:not([type='hidden'])",
		]) {
			expect(HINT_SELECTOR).toContain(part);
		}
	});

	it("takes a list or slider only when it can hold focus", () => {
		const parts = HINT_SELECTOR.split(", ");
		expect(parts).toContain("[role='listbox'][tabindex]");
		expect(parts).toContain("[role='slider'][tabindex]");
		expect(parts).not.toContain("[role='listbox']");
		expect(parts).not.toContain("[role='slider']");
	});
});
