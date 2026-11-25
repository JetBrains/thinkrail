import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { sameModel, type WireModel } from "@thinkrail/contracts";
import { parseHTML } from "linkedom";
import type { Root } from "react-dom/client";
import type {
	ModelEffortPickerHandle,
	ModelEffortPickerProps,
	ModelSelection,
} from "./ModelEffortPicker";
import type { ModelPreferences } from "./useModelPreferences";

if (process.env.THINKRAIL_MODEL_PICKER_DOM_CHILD !== "1") {
	test("the mounted model picker preserves selection, navigation and copy behavior", async () => {
		const child = Bun.spawn([process.execPath, "test", import.meta.path], {
			cwd: resolve(import.meta.dir, "../.."),
			env: { ...process.env, THINKRAIL_MODEL_PICKER_DOM_CHILD: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (code !== 0) throw new Error(`Mounted picker checks failed (${code}):\n${stdout}${stderr}`);
		expect(code).toBe(0);
	}, 15_000);
} else {
	const dom = parseHTML("<!doctype html><html><body></body></html>");
	let active = dom.document.body;
	const scrolled: Element[] = [];
	const copied: string[] = [];
	Object.defineProperty(dom.document, "activeElement", { get: () => active });
	Object.defineProperty(dom.document, "oninput", { value: null });
	dom.HTMLElement.prototype.focus = function () {
		if (this.isConnected) active = this;
	};
	dom.HTMLElement.prototype.scrollIntoView = function () {
		scrolled.push(this);
	};
	dom.HTMLElement.prototype.getClientRects = function () {
		const rects = [this.getBoundingClientRect()];
		return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
	};
	dom.HTMLElement.prototype.hasPointerCapture = () => false;
	const defaults: Record<string, string> = {
		display: "block",
		position: "static",
		direction: "ltr",
		visibility: "visible",
		animationName: "none",
		overflow: "visible",
		overflowX: "visible",
		overflowY: "visible",
		width: "300px",
		height: "24px",
		marginTop: "0px",
		marginBottom: "0px",
	};
	const getComputedStyle = (element: Element): CSSStyleDeclaration =>
		new Proxy((element as HTMLElement).style, {
			get(target, key) {
				if (key === "getPropertyValue") {
					return (name: string) => target.getPropertyValue(name) ?? "";
				}
				return Reflect.get(target, key) ?? (typeof key === "string" ? defaults[key] : "") ?? "";
			},
		});
	const requestAnimationFrame = (callback: FrameRequestCallback) =>
		Number(setTimeout(() => callback(performance.now()), 0));
	const resizeObservers = new Set<ResizeObserverFixture>();
	class ResizeObserverFixture {
		readonly targets = new Set<Element>();
		readonly callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
			resizeObservers.add(this);
		}
		observe(target: Element) {
			this.targets.add(target);
		}
		unobserve(target: Element) {
			this.targets.delete(target);
		}
		disconnect() {
			this.targets.clear();
			resizeObservers.delete(this);
		}
	}
	Object.assign(globalThis, {
		window: dom,
		document: dom.document,
		navigator: {
			userAgent: "DOM fixture",
			clipboard: { writeText: async (text: string) => void copied.push(text) },
		},
		HTMLElement: dom.HTMLElement,
		Element: dom.Element,
		HTMLInputElement: dom.HTMLInputElement,
		HTMLButtonElement: dom.HTMLButtonElement,
		HTMLSelectElement: dom.HTMLSelectElement,
		Node: dom.Node,
		NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
		Event: dom.Event,
		CustomEvent: dom.CustomEvent,
		MutationObserver: dom.MutationObserver,
		ResizeObserver: ResizeObserverFixture,
		getComputedStyle,
		requestAnimationFrame,
		cancelAnimationFrame: clearTimeout,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	Object.assign(dom, {
		getComputedStyle,
		requestAnimationFrame,
		cancelAnimationFrame: clearTimeout,
	});
	dom.ResizeObserver = ResizeObserverFixture;
	const { act, createElement, createRef } = await import("react");
	const { createRoot } = await import("react-dom/client");
	const { TooltipProvider } = await import("@thinkrail/ui/tooltip");
	const { ModelEffortPicker } = await import("./ModelEffortPicker");
	const catalog: WireModel[] = Array.from({ length: 40 }, (_, index) => ({
		provider: "fireworks",
		id: `accounts/fireworks/models/variant-${String(index).padStart(2, "0")}`,
		name: "Readable model name",
		contextWindow: 100_000,
		reasoning: false,
		thinkingLevels: ["off"],
		auth: { kind: "api-key", detail: "Configured API key" },
	}));
	const current = catalog[39] as WireModel;
	let root: Root | undefined;
	const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
	const preferences = (
		favorites: WireModel[] = [],
		recents: WireModel[] = [],
	): ModelPreferences => ({
		supported: true,
		favorites,
		recents,
		defaultEffort: undefined,
		isFavorite: (model) => favorites.some((favorite) => sameModel(model, favorite)),
		toggleFavorite() {},
		isDefault: () => false,
		setDefault() {},
	});
	function element(selector: string, scope: ParentNode = dom.document): HTMLElement {
		const found = scope.querySelector<HTMLElement>(selector);
		if (!found) throw new Error(`Missing element: ${selector}`);
		return found;
	}
	function row(model: WireModel): HTMLElement {
		return element(`[data-testid="model-option"][data-model-id="${model.id}"]`);
	}
	function selected(): HTMLElement {
		return element('[cmdk-item][aria-selected="true"]');
	}
	function rect(top: number, height: number): DOMRect {
		return {
			x: 0,
			y: top,
			width: 240,
			height,
			top,
			bottom: top + height,
			left: 0,
			right: 240,
			toJSON: () => ({ top, height }),
		};
	}
	async function resize(target: Element) {
		const contentRect = target.getBoundingClientRect();
		const box = { inlineSize: contentRect.width, blockSize: contentRect.height };
		const entry = {
			target,
			contentRect,
			borderBoxSize: [box],
			contentBoxSize: [box],
			devicePixelContentBoxSize: [box],
		};
		await act(() => {
			for (const observer of resizeObservers) {
				if (observer.targets.has(target)) observer.callback([entry], observer);
			}
		});
	}
	async function event(target: HTMLElement, type: string, key?: string): Promise<Event> {
		const dispatched = new dom.Event(type, { bubbles: true, cancelable: true });
		if (key) Object.defineProperty(dispatched, "key", { value: key });
		await act(async () => {
			target.dispatchEvent(dispatched);
			await pause();
		});
		return dispatched;
	}
	async function mount(overrides: Partial<ModelEffortPickerProps> = {}, query = "") {
		const container = dom.document.createElement("div");
		dom.document.body.append(container);
		root = createRoot(container);
		const handle = createRef<ModelEffortPickerHandle>();
		const selections: ModelSelection[] = [];
		const props: ModelEffortPickerProps = {
			models: catalog,
			current,
			level: "off",
			preferences: preferences(),
			onSelect(selection) {
				selections.push(selection);
				props.current = selection.model;
				render();
			},
			onSelectLevel() {},
			refreshing: false,
			onRefresh() {},
			...overrides,
		};
		function render() {
			root?.render(
				createElement(
					TooltipProvider,
					null,
					createElement(ModelEffortPicker, { ...props, ref: handle }),
				),
			);
		}
		async function open(next = "") {
			await act(async () => {
				handle.current?.open(next);
				await pause();
			});
		}
		await act(render);
		await open(query);
		return { handle, props, selections, render, open };
	}
	afterEach(async () => {
		await act(async () => {
			root?.unmount();
			await pause();
		});
		root = undefined;
		dom.document.body.replaceChildren();
		active = dom.document.body;
		scrolled.length = 0;
		copied.length = 0;
	});

	test("opening a long catalog selects and scrolls to the current model", async () => {
		await mount();
		const rows = dom.document.querySelectorAll('[data-testid="model-option"]');
		expect(rows).toHaveLength(40);
		expect(rows[39]?.getAttribute("data-model-id")).toBe(current.id);
		expect(selected().getAttribute("data-model-id")).toBe(current.id);
		expect(scrolled.includes(row(current))).toBe(true);
	});

	test("fitting the list after its initial scroll keeps the selected row visible", async () => {
		await mount();
		const list = element("[cmdk-list]");
		const currentRow = row(current);
		let height = 340;
		list.scrollTop = 1420;
		list.getBoundingClientRect = () => rect(100, height);
		currentRow.getBoundingClientRect = () => rect(100 + 1720 - list.scrollTop, 40);
		expect(currentRow.getBoundingClientRect().bottom).toBe(list.getBoundingClientRect().bottom);
		dom.document.body.scrollTop = 75;
		height = 120;
		await resize(list);
		expect(currentRow.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
		expect(currentRow.getBoundingClientRect().bottom).toBeLessThanOrEqual(220);
		expect(dom.document.body.scrollTop).toBe(75);
		expect(selected()).toBe(currentRow);
	});

	test("a list resize reveals the keyboard highlight without resetting the selected model", async () => {
		const picker = await mount();
		await event(element("[cmdk-input]"), "keydown", "ArrowUp");
		const previous = row(catalog[38] as WireModel);
		const list = element("[cmdk-list]");
		list.scrollTop = 1720;
		list.getBoundingClientRect = () => rect(100, 120);
		previous.getBoundingClientRect = () => rect(100 + 1680 - list.scrollTop, 40);
		await resize(list);
		expect(previous.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
		expect(previous.getBoundingClientRect().bottom).toBeLessThanOrEqual(220);
		expect(selected()).toBe(previous);
		expect(picker.selections).toEqual([]);
	});

	test("the current model is revealed even when it is outside the pinned and recent shortlist", async () => {
		await mount({ preferences: preferences([catalog[0] as WireModel], [catalog[1] as WireModel]) });
		expect(selected().getAttribute("data-model-id")).toBe(current.id);
		expect(scrolled.includes(row(current))).toBe(true);
		expect(dom.document.querySelector('[data-testid="model-show-all"]')).toBeNull();
	});

	for (const section of ["favorites", "recents"] as const) {
		test(`opening selects the current ${section} row instead of the first shortcut`, async () => {
			const list = [catalog[0] as WireModel, current];
			await mount({
				preferences: section === "favorites" ? preferences(list) : preferences([], list),
			});
			expect(selected().getAttribute("data-model-id")).toBe(current.id);
			expect(scrolled.includes(row(current))).toBe(true);
			expect(dom.document.querySelectorAll('[data-testid="model-option"]')).toHaveLength(2);
			expect(element('[data-testid="model-show-all"]')).toBeDefined();
		});
	}

	test("following the host default highlights Default rather than its resolved model", async () => {
		await mount({
			defaultOption: {
				active: true,
				resolved: { model: current, thinkingLevel: "off" },
				onSelect() {},
			},
		});
		expect(selected().getAttribute("data-testid")).toBe("model-option-default");
		expect(scrolled.includes(selected())).toBe(true);
	});

	test("a prefilled canonical-ID search is preserved instead of forcing the current model", async () => {
		const target = catalog[0] as WireModel;
		await mount({}, target.id);
		expect((element("[cmdk-input]") as HTMLInputElement).value).toBe(target.id);
		expect(row(target)).toBeDefined();
		expect(dom.document.querySelector(`[data-model-id="${current.id}"]`)).toBeNull();
		expect(selected().getAttribute("data-testid")).toBe("model-group-toggle");
	});

	test("a missing current model keeps cmdk's first-item fallback", async () => {
		const first = catalog[0] as WireModel;
		await mount({ current: null, preferences: preferences([first]) });
		expect(selected().getAttribute("data-model-id")).toBe(first.id);
	});

	test("keyboard navigation survives rerenders, applies a new model and reopens on it", async () => {
		const picker = await mount();
		await event(element("[cmdk-input]"), "keydown", "ArrowUp");
		const previous = catalog[38] as WireModel;
		expect(selected().getAttribute("data-model-id")).toBe(previous.id);
		await act(picker.render);
		expect(selected().getAttribute("data-model-id")).toBe(previous.id);
		await event(element("[cmdk-input]"), "keydown", "Enter");
		expect(picker.selections).toEqual([{ model: previous }]);
		expect(element('[data-testid="model-selector"]').getAttribute("data-open")).toBe("true");
		await event(element('[data-testid="model-selector"]'), "click");
		expect(dom.document.querySelector("[cmdk-list]")).toBeNull();
		await picker.open();
		expect(selected().getAttribute("data-model-id")).toBe(previous.id);
		expect(scrolled.includes(row(previous))).toBe(true);
	});

	test("full names and IDs are exposed, and copying never selects a different model", async () => {
		const picker = await mount();
		for (const target of [element('[data-testid="model-selector"]'), row(current)]) {
			expect(target.title).toContain(current.name);
			expect(target.title).toContain(current.id);
			expect(target.title).toContain("Configured API key");
		}
		const other = catalog[0] as WireModel;
		expect(row(other).textContent).toContain(`${other.provider}/${other.id}`);
		const copy = element('[data-testid="chat-copy"]', row(other));
		expect(copy.getAttribute("aria-label")).toContain(other.id);
		await event(copy, "click");
		expect(copy.getAttribute("data-copied")).toBe("true");
		for (const key of ["Enter", " "]) {
			copy.focus();
			const keydown = await event(copy, "keydown", key);
			expect(keydown.defaultPrevented).toBe(false);
			await event(copy, "click");
		}
		expect(copied).toEqual([other.id, other.id, other.id]);
		expect(picker.selections).toEqual([]);
		expect(element('[data-testid="model-selector"]').getAttribute("data-open")).toBe("true");
	});
}
