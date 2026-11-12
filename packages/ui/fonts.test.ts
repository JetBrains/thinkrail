import { expect, mock, test } from "bun:test";
import { fontsLoaded, fontsRevision, onFontsChange, watchFont } from "./fonts";

test("onFontsChange observes only the published fonts revision and returns cleanup", () => {
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
	const root = { dataset: { fonts: "abc" } };
	const observe = mock((_target: unknown, _options: MutationObserverInit) => {});
	const disconnect = mock(() => {});
	const onChange = mock(() => {});
	let notify: (() => void) | undefined;
	class Observer {
		constructor(callback: () => void) {
			notify = callback;
		}
		observe = observe;
		disconnect = disconnect;
	}

	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { documentElement: root },
		});
		Object.defineProperty(globalThis, "MutationObserver", {
			configurable: true,
			value: Observer,
		});
		const stop = onFontsChange(onChange);
		expect(observe).toHaveBeenCalledWith(root, {
			attributes: true,
			attributeFilter: ["data-fonts"],
		});
		notify?.();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(fontsRevision()).toBe("abc");
		stop();
		expect(disconnect).toHaveBeenCalledTimes(1);
	} finally {
		if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
		else Reflect.deleteProperty(globalThis, "document");
		if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver);
		else Reflect.deleteProperty(globalThis, "MutationObserver");
	}
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeFontState {
	fonts: string;
	fontFaces: string;
	family: string;
	size: number;
}

function withFakeFonts(
	run: (state: FakeFontState, change: () => void, loads: (() => void)[]) => Promise<void>,
) {
	const saved = ["document", "MutationObserver", "getComputedStyle"].map(
		(name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
	);
	const state: FakeFontState = { fonts: "1", fontFaces: "0", family: '"Fira Code"', size: 13 };
	const loads: (() => void)[] = [];
	let notify: (() => void) | undefined;
	const define = (name: string, value: unknown) =>
		Object.defineProperty(globalThis, name, { configurable: true, value });
	define("document", {
		documentElement: {
			dataset: {
				get fonts() {
					return state.fonts;
				},
				get fontFaces() {
					return state.fontFaces;
				},
			},
		},
		body: { append: () => {} },
		createElement: () => ({
			setAttribute: () => {},
			style: { setProperty: () => {} },
			remove: () => {},
		}),
		fonts: { load: () => new Promise<void>((resolve) => loads.push(resolve)) },
	});
	define(
		"MutationObserver",
		class {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	define("getComputedStyle", () => ({
		fontFamily: state.family,
		fontSize: `${state.size}px`,
		fontWeight: "400",
		fontVariantLigatures: "none",
	}));
	return run(state, () => notify?.(), loads).finally(() => {
		for (const [name, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	});
}

test("watchFont applies only the latest change, once its faces have loaded", () =>
	withFakeFonts(async (state, change, loads) => {
		const applied: number[] = [];
		const stop = watchFont("tr-code-block", ["family", "size"], (font) => applied.push(font.size));
		state.size = 14;
		change();
		state.size = 15;
		change();
		loads[1]?.();
		loads[0]?.();
		await settle();
		expect(applied).toEqual([15]);
		stop();
	}));

test("watchFont re-applies an unchanged family when the face set changes, and skips a no-op", () =>
	withFakeFonts(async (state, change, loads) => {
		const applied: string[] = [];
		const stop = watchFont("tr-code-block", ["family"], (font) => applied.push(font.family));
		state.fonts = "2";
		change();
		loads[0]?.();
		await settle();
		expect(applied).toEqual([]);
		state.fontFaces = "1";
		change();
		loads[1]?.();
		await settle();
		expect(applied).toEqual(['"Fira Code"']);
		stop();
	}));

test("fontsLoaded waits for the face of the resolved weight, not just the regular one", async () => {
	const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const load = mock((_font: string) => Promise.resolve([]));
	try {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { fonts: { load } },
		});
		await fontsLoaded({
			family: '"Ubuntu Mono", monospace',
			size: 18,
			weight: 530,
			ligatures: false,
		});
		expect(load).toHaveBeenCalledWith('530 18px "Ubuntu Mono", monospace');
	} finally {
		if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
		else Reflect.deleteProperty(globalThis, "document");
	}
});
