import { afterAll, beforeAll, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { DiffTabView } from "../store";
import { useResponsiveDiffView } from "./useResponsiveDiffView";

type Observation = { notify: () => void; target: unknown; disconnected: boolean };
const resized: Observation[] = [];
const fontChanges: Observation[] = [];
const font = { size: 11, family: "monospace", advance: 6.6, delayed: false };
const fontLoads: (() => void)[] = [];
const probes = new Set<unknown>();
const saved = [
	"window",
	"document",
	"getComputedStyle",
	"ResizeObserver",
	"MutationObserver",
	"IS_REACT_ACT_ENVIRONMENT",
].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);

function observerFor(observations: Observation[]) {
	return class {
		entry: Observation;
		constructor(notify: () => void) {
			this.entry = { notify, target: null, disconnected: false };
			observations.push(this.entry);
		}
		observe(target: unknown) {
			this.entry.target = target;
		}
		disconnect() {
			this.entry.disconnected = true;
		}
	};
}

beforeAll(() => {
	const document = {
		activeElement: null,
		documentElement: { dataset: { fonts: "1", fontFaces: "1" } },
		body: { append: (probe: unknown) => probes.add(probe) },
		createElement: () => {
			const probe = {
				className: "",
				textContent: "",
				setAttribute: () => {},
				style: { setProperty: () => {} },
				getBoundingClientRect: () => ({ width: probe.textContent.length * font.advance }),
				remove: () => probes.delete(probe),
			};
			return probe;
		},
		fonts: {
			load: () =>
				font.delayed ? new Promise<void>((resolve) => fontLoads.push(resolve)) : Promise.resolve(),
		},
	};
	const values = {
		document,
		window: { document, event: undefined, HTMLIFrameElement: class {} },
		getComputedStyle: () => ({
			fontFamily: font.family,
			fontSize: `${font.size}px`,
			fontWeight: "400",
			fontVariantLigatures: "none",
		}),
		ResizeObserver: observerFor(resized),
		MutationObserver: observerFor(fontChanges),
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(values))
		Object.defineProperty(globalThis, key, { configurable: true, value });
});

afterAll(() => {
	for (const [key, descriptor] of saved) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

function headlessContainer(): Element {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}

async function mount(explicit?: DiffTabView, mobile = false) {
	let current: ReturnType<typeof useResponsiveDiffView> | undefined;
	let renders = 0;
	function Probe(props: { explicit: DiffTabView | undefined; mobile: boolean }) {
		current = useResponsiveDiffView(props.explicit, props.mobile);
		renders += 1;
		return null;
	}
	const root = createRoot(headlessContainer());
	const render = (node: ReactNode) => act(async () => root.render(node));
	await render(<Probe explicit={explicit} mobile={mobile} />);
	const state = () => {
		if (!current) throw new Error("The responsive view hook did not mount");
		return current;
	};
	return {
		view: () => state()[1],
		renders: () => renders,
		attach: (element: HTMLElement | null) => act(async () => state()[0](element)),
		update: (choice: DiffTabView | undefined, phone = false) =>
			render(<Probe explicit={choice} mobile={phone} />),
		unmount: () => act(async () => root.unmount()),
	};
}

function pane(initial: number) {
	let width = initial;
	let reads = 0;
	const element = {
		getBoundingClientRect: () => {
			reads += 1;
			return { width };
		},
	} as unknown as HTMLElement;
	return {
		element,
		reads: () => reads,
		resize: (next: number) =>
			act(async () => {
				width = next;
				for (const entry of resized)
					if (entry.target === element && !entry.disconnected) entry.notify();
			}),
	};
}

const changeFont = (size: number, advance: number, family = "monospace") =>
	act(async () => {
		Object.assign(font, { size, advance, family });
		for (const entry of fontChanges) if (!entry.disconnected) entry.notify();
	});

test("automatic diff views follow each pane's own width and keep hidden panes stable", async () => {
	Object.assign(font, { size: 11, advance: 6.6, family: "monospace", delayed: false });
	const narrow = pane(420);
	const wide = pane(1000);
	const first = await mount();
	const second = await mount();
	try {
		await first.attach(narrow.element);
		await second.attach(wide.element);
		expect(first.view()).toBe("inline");
		expect(second.view()).toBe("split");
		await narrow.resize(800);
		expect(first.view()).toBe("split");
		await narrow.resize(0);
		expect(first.view()).toBe("split");
		await narrow.resize(450);
		expect(first.view()).toBe("inline");
		expect(second.view()).toBe("split");
		expect(probes.size).toBe(0);
	} finally {
		await first.unmount();
		await second.unmount();
	}
});

test("the current code font's size and character width both affect automatic layout", async () => {
	Object.assign(font, { size: 11, advance: 6.6, family: "monospace", delayed: true });
	const box = pane(800);
	const view = await mount();
	try {
		await view.attach(box.element);
		expect(view.view()).toBe("split");
		await act(async () => {
			font.advance = 9;
			for (const resolve of fontLoads.splice(0)) resolve();
		});
		expect(view.view()).toBe("inline");
		font.delayed = false;
		await changeFont(20, 12);
		expect(view.view()).toBe("inline");
		await changeFont(20, 8, "narrow-mono");
		expect(view.view()).toBe("split");
		await changeFont(20, 10, "wide-mono");
		expect(view.view()).toBe("inline");
	} finally {
		font.delayed = false;
		await view.unmount();
	}
});

test("an explicit tab choice survives resize, font changes, remount and a phone round trip", async () => {
	Object.assign(font, { size: 11, advance: 6.6, family: "monospace", delayed: false });
	const box = pane(420);
	const view = await mount();
	try {
		await view.attach(box.element);
		expect(view.view()).toBe("inline");
		await view.update("split");
		expect(view.view()).toBe("split");
		expect(resized.filter((entry) => !entry.disconnected)).toHaveLength(0);
		await box.resize(300);
		await changeFont(20, 12);
		expect(view.view()).toBe("split");
		await view.update("split", true);
		expect(view.view()).toBe("inline");
		await view.update("split");
		expect(view.view()).toBe("split");
		await view.update("inline");
		await box.resize(1600);
		expect(view.view()).toBe("inline");
	} finally {
		await view.unmount();
	}
	const restored = await mount("inline");
	try {
		await restored.attach(box.element);
		expect(restored.view()).toBe("inline");
		expect(resized.filter((entry) => !entry.disconnected)).toHaveLength(0);
	} finally {
		await restored.unmount();
	}
});

test("changing the measured content viewport retires old callbacks and pending font loads", async () => {
	Object.assign(font, { size: 11, advance: 6.6, family: "monospace", delayed: true });
	const first = pane(1000);
	const next = pane(420);
	const view = await mount();
	try {
		await view.attach(first.element);
		expect(view.view()).toBe("split");
		const retired = resized.findLast((entry) => entry.target === first.element);
		expect(retired).toBeDefined();
		await view.attach(next.element);
		expect(view.view()).toBe("inline");
		expect(retired?.disconnected).toBe(true);
		const reads = first.reads();
		await act(async () => retired?.notify());
		expect(first.reads()).toBe(reads);
		await view.unmount();
		const renders = view.renders();
		const nextReads = next.reads();
		await act(async () => {
			for (const resolve of fontLoads.splice(0)) resolve();
			for (const entry of resized) entry.notify();
		});
		expect(view.renders()).toBe(renders);
		expect(next.reads()).toBe(nextReads);
		expect(fontChanges.filter((entry) => !entry.disconnected)).toHaveLength(0);
		expect(probes.size).toBe(0);
	} finally {
		font.delayed = false;
		await view.unmount();
	}
});
