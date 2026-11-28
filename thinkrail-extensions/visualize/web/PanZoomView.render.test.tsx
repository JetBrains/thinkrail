import { afterEach, beforeEach, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PanZoomView } from "./PanZoomView";

const SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><text x="4" y="20">Diagram</text></svg>';
const GLOBALS = [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"ResizeObserver",
	"IS_REACT_ACT_ENVIRONMENT",
] as const;
const saved = new Map(
	GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
let dom: ReturnType<typeof parseHTML>;
let root: Root | undefined;
let observers: Set<ResizeObserverFixture>;
let dimensions: Map<string, PropertyDescriptor | undefined>;

class ResizeObserverFixture implements ResizeObserver {
	readonly targets = new Set<Element>();
	private readonly callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		observers.add(this);
	}
	observe(target: Element) {
		this.targets.add(target);
	}
	unobserve(target: Element) {
		this.targets.delete(target);
	}
	disconnect() {
		this.targets.clear();
		observers.delete(this);
	}
	resize() {
		this.callback([], this);
	}
}

beforeEach(() => {
	dom = parseHTML("<!doctype html><html><body></body></html>");
	observers = new Set();
	dimensions = new Map(
		["clientWidth", "clientHeight"].map((key) => [
			key,
			Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, key),
		]),
	);
	Object.defineProperties(dom.HTMLElement.prototype, {
		clientWidth: { configurable: true, get: () => 200 },
		clientHeight: { configurable: true, get: () => 120 },
	});
	const values = {
		window: dom,
		document: dom.document,
		HTMLElement: dom.HTMLElement,
		Element: dom.Element,
		Node: dom.Node,
		ResizeObserver: ResizeObserverFixture,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const key of GLOBALS) {
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value: values[key],
		});
	}
});

afterEach(async () => {
	try {
		await act(async () => root?.unmount());
		root = undefined;
	} finally {
		for (const [key, descriptor] of dimensions) {
			if (descriptor) Object.defineProperty(dom.HTMLElement.prototype, key, descriptor);
			else Reflect.deleteProperty(dom.HTMLElement.prototype, key);
		}
		for (const key of GLOBALS) {
			const descriptor = saved.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});

function event(type: string, fields: Record<string, unknown> = {}): Event {
	const value = new dom.Event(type, { bubbles: true, cancelable: true });
	for (const [key, field] of Object.entries(fields))
		Object.defineProperty(value, key, { value: field });
	return value;
}

async function mount(inline: boolean, svg = SVG) {
	const container = dom.document.createElement("div");
	dom.document.body.append(container);
	root = createRoot(container);
	let opened = 0;
	await act(async () =>
		root?.render(
			<TooltipProvider>
				<PanZoomView
					svg={svg}
					inline={inline}
					actions={
						inline ? (
							<button
								type="button"
								onClick={() => {
									opened += 1;
								}}
							>
								Open diagram
							</button>
						) : null
					}
				/>
			</TooltipProvider>,
		),
	);
	const element = (id: string) => {
		const found = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
		if (!found) throw new Error(`Missing ${id}`);
		return found;
	};
	const viewport = element(inline ? "mermaid-svg" : "mermaid-fullscreen-svg");
	viewport.scrollLeft = 0;
	viewport.scrollTop = 0;
	const click = (id: string) =>
		act(async () => {
			element(id).dispatchEvent(event("click", { button: 0 }));
		});
	return { container, viewport, element, click, opened: () => opened };
}

function geometry(viewport: HTMLElement, width: number, height: number) {
	const drawing = viewport.querySelector("svg");
	if (!drawing) throw new Error("Missing drawing");
	const size = { width, height };
	drawing.getBoundingClientRect = () => ({
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		right: size.width,
		bottom: size.height,
		width: size.width,
		height: size.height,
		toJSON: () => size,
	});
	return size;
}

test.each([
	["inline", true],
	["fullscreen", false],
])("the mounted %s diagram supports zoom and reset", async (_mode, inline) => {
	const view = await mount(inline);
	expect(observers.size).toBe(inline ? 1 : 0);
	expect(view.viewport.querySelector("svg text")?.textContent).toBe("Diagram");
	expect(view.element("mermaid-zoom-level").textContent).toBe("100%");
	await view.click("mermaid-zoom-in");
	expect(view.element("mermaid-zoom-level").textContent).toBe("125%");
	await view.click("mermaid-zoom-out");
	expect(view.element("mermaid-zoom-level").textContent).toBe("100%");
	for (let i = 0; i < 10; i++) await view.click("mermaid-zoom-in");
	expect(view.element("mermaid-zoom-level").textContent).toBe("500%");
	view.viewport.scrollLeft = 120;
	view.viewport.scrollTop = 80;
	await view.click("mermaid-zoom-reset");
	expect(view.element("mermaid-zoom-level").textContent).toBe("100%");
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([0, 0]);
	if (inline) {
		const action = [...view.container.querySelectorAll("button")].find(
			(button) => button.textContent === "Open diagram",
		);
		if (!action) throw new Error("Missing diagram action");
		await act(async () => {
			action.dispatchEvent(event("click", { button: 0 }));
		});
		expect(view.opened()).toBe(1);
	}
});

test("inline wheel scrolling is unclaimed while modifier zoom and pinch stay local", async () => {
	const view = await mount(true);
	const wheel = event("wheel", { deltaY: -100, ctrlKey: false, metaKey: false });
	await act(async () => {
		view.viewport.dispatchEvent(wheel);
	});
	expect(wheel.defaultPrevented).toBe(false);
	expect(view.element("mermaid-zoom-level").textContent).toBe("100%");
	const zoom = event("wheel", { deltaY: -100, ctrlKey: true, metaKey: false });
	await act(async () => {
		view.viewport.dispatchEvent(zoom);
	});
	expect(zoom.defaultPrevented).toBe(true);
	expect(view.element("mermaid-zoom-level").textContent).toBe("110%");
	const start = event("gesturestart");
	const change = event("gesturechange", { scale: 2 });
	const end = event("gestureend");
	await act(async () => {
		for (const value of [start, change, end]) view.viewport.dispatchEvent(value);
	});
	expect([start, change, end].map((value) => value.defaultPrevented)).toEqual([true, true, true]);
	expect(view.element("mermaid-zoom-level").textContent).toBe("220%");
	await act(async () => root?.unmount());
	root = undefined;
	const removedWheel = event("wheel", { deltaY: -100, ctrlKey: true });
	const removedGesture = event("gesturestart");
	view.viewport.dispatchEvent(removedWheel);
	view.viewport.dispatchEvent(removedGesture);
	expect([removedWheel.defaultPrevented, removedGesture.defaultPrevented]).toEqual([false, false]);
});

test("inline mouse drag pans until capture ends and leaves touch/right-button gestures alone", async () => {
	const view = await mount(true);
	geometry(view.viewport, 500, 600);
	let captured: number | undefined;
	view.viewport.scrollLeft = 0;
	view.viewport.scrollTop = 0;
	view.viewport.setPointerCapture = (id) => {
		captured = id;
	};
	view.viewport.hasPointerCapture = (id) => captured === id;
	view.viewport.releasePointerCapture = () => {
		captured = undefined;
	};
	const send = async (type: string, x: number, y: number, fields: Record<string, unknown> = {}) => {
		await act(async () => {
			view.viewport.dispatchEvent(
				event(type, {
					pointerId: 1,
					pointerType: "mouse",
					button: 0,
					clientX: x,
					clientY: y,
					...fields,
				}),
			);
		});
	};
	await send("pointerdown", 200, 180);
	expect(captured).toBe(1);
	await send("pointermove", 120, 100);
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([80, 80]);
	await send("pointermove", -800, -820);
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([300, 480]);
	await send("pointermove", 120, 100);
	await send("lostpointercapture", 120, 100);
	await send("pointermove", 20, 0);
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([80, 80]);
	for (const fields of [{ pointerType: "touch" }, { button: 2 }]) {
		await send("pointerdown", 200, 180, fields);
		await send("pointermove", 120, 100, fields);
		expect(captured).toBeUndefined();
		expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([80, 80]);
	}
});

test.each([
	["inline", "href", true],
	["inline", "xlink:href", true],
	["fullscreen", "href", false],
	["fullscreen", "xlink:href", false],
] as const)(
	"%s %s links and their descendants do not start a mouse pan",
	async (_mode, href, inline) => {
		const view = await mount(
			inline,
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a ${href}="https://example.com" target="_blank"><g><text id="label">Docs</text></g></a><text id="background">Diagram</text></svg>`,
		);
		geometry(view.viewport, 500, 600);
		view.viewport.scrollLeft = 40;
		view.viewport.scrollTop = 50;
		const captures: number[] = [];
		let captured: number | undefined;
		view.viewport.setPointerCapture = (id) => {
			captures.push(id);
			captured = id;
		};
		view.viewport.hasPointerCapture = (id) => captured === id;
		view.viewport.releasePointerCapture = () => {
			captured = undefined;
		};
		const send = async (target: Element, type: string, x: number, y: number) => {
			const value = event(type, {
				pointerId: 1,
				pointerType: "mouse",
				button: 0,
				clientX: x,
				clientY: y,
			});
			await act(async () => {
				target.dispatchEvent(value);
			});
			return value;
		};
		for (const selector of ["a", "#label"]) {
			const target = view.viewport.querySelector(selector);
			if (!target) throw new Error(`Missing ${selector}`);
			const down = await send(target, "pointerdown", 200, 180);
			await send(view.viewport, "pointermove", 120, 100);
			await send(view.viewport, "pointerup", 120, 100);
			expect(captures).toEqual([]);
			expect(down.defaultPrevented).toBe(false);
			expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([40, 50]);
		}
		const background = view.viewport.querySelector("#background");
		if (!background) throw new Error("Missing non-link drawing");
		await send(background, "pointerdown", 200, 180);
		await send(view.viewport, "pointermove", 120, 100);
		await send(view.viewport, "pointerup", 120, 100);
		expect(captures).toEqual([1]);
		expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([120, 130]);
	},
);

test("inline pan is clamped to the rendered drawing after zoom and resize", async () => {
	const view = await mount(true);
	const size = geometry(view.viewport, 500, 600);
	expect(observers.size).toBe(1);
	const observer = [...observers][0];
	if (!observer) throw new Error("Missing size observer");
	const drawing = view.viewport.querySelector("svg");
	if (!drawing) throw new Error("Missing drawing");
	expect([...observer.targets]).toEqual([view.viewport, drawing]);
	view.viewport.scrollLeft = 300;
	view.viewport.scrollTop = 480;
	size.width = 400;
	size.height = 480;
	await view.click("mermaid-zoom-out");
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([200, 360]);
	size.width = 250;
	size.height = 300;
	await act(async () => observer.resize());
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([50, 180]);
	Object.defineProperties(view.viewport, {
		clientWidth: { value: 300 },
		clientHeight: { value: 400 },
	});
	await act(async () => observer.resize());
	expect([view.viewport.scrollLeft, view.viewport.scrollTop]).toEqual([0, 0]);
	await act(async () => root?.unmount());
	root = undefined;
	expect(observers.size).toBe(0);
	expect(observer.targets.size).toBe(0);
});
