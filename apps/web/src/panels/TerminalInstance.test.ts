import { beforeAll, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import * as ptySizeSync from "./ptySizeSync";
import * as terminalPrebindBuffer from "./terminalPrebindBuffer";

let source: string;
beforeAll(async () => {
	const build = await Bun.build({
		entrypoints: [new URL("./TerminalInstance.tsx", import.meta.url).pathname],
		target: "node",
		format: "cjs",
		external: ["*"],
	});
	expect(build.success).toBe(true);
	const output = build.outputs[0];
	if (!output) throw new Error("Terminal fixture did not build");
	source = await output.text();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(timeoutMs = 1000) {
	let family = "Initial Terminal";
	let notify = () => {};
	let watching = false;
	let releaseFonts = () => {};
	const fonts = new Promise<void>((resolve) => {
		releaseFonts = resolve;
	});
	const effects: (() => (() => void) | undefined)[] = [];
	const calls: { method: string; params: unknown }[] = [];
	const familyWrites: string[] = [];
	const terminals: FakeTerminal[] = [];
	let fits = 0;
	let addonDisposed = false;
	let deadline: number | undefined;
	let refIndex = 0;
	const disposable = () => ({ dispose() {} });
	class FakeTerminal {
		options: { fontFamily: string };
		cols = 80;
		rows = 24;
		unicode = { activeVersion: "" };
		buffer = { active: { viewportY: 0, baseY: 0 } };
		output = "";
		disposed = false;
		constructor(options: { fontFamily: string }) {
			this.options = new Proxy(options, {
				set(target, key, value) {
					if (key === "fontFamily") familyWrites.push(value);
					return Reflect.set(target, key, value);
				},
			});
			terminals.push(this);
		}
		loadAddon(addon: { activate?: (term: FakeTerminal) => void }) {
			addon.activate?.(this);
		}
		open() {}
		onScroll = disposable;
		onWriteParsed = disposable;
		onResize = disposable;
		onData = disposable;
		attachCustomKeyEventHandler() {}
		write(data: string, done?: () => void) {
			this.output += data;
			done?.();
		}
		dispose() {
			this.disposed = true;
			addonDisposed = true;
		}
	}
	class WebFonts {
		term: FakeTerminal | undefined;
		activate(term: FakeTerminal) {
			this.term = term;
		}
		async relayout() {
			const term = this.term;
			if (!term) return;
			const captured = term.options.fontFamily;
			await fonts;
			if (addonDisposed) return;
			term.options.fontFamily = "monospace";
			term.options.fontFamily = captured;
		}
		dispose() {
			addonDisposed = true;
		}
	}
	const host = { clientWidth: 800, clientHeight: 600 };
	const transport = {
		subscribe: () => () => {},
		request: async (method: string, params: unknown) => {
			calls.push({ method, params });
			return { id: "pty", created: false, replay: "existing output" };
		},
	};
	const modules: Record<string, unknown> = {
		"@thinkrail/contracts": { WS_CHANNELS: {} },
		"@thinkrail/locales/react": { useT: () => (key: string) => key, i18n: { t: String } },
		"@thinkrail/ui/button": {},
		"@thinkrail/ui/theme": { onThemeSwap: () => () => {} },
		"@thinkrail/ui/typography": {
			onFontChange(callback: () => void) {
				notify = callback;
				watching = true;
				return () => {
					watching = false;
				};
			},
		},
		"@xterm/addon-clipboard": { ClipboardAddon: class {} },
		"@xterm/addon-unicode11": { Unicode11Addon: class {} },
		"@xterm/addon-web-fonts": { WebFontsAddon: WebFonts },
		"@xterm/addon-fit": {
			FitAddon: class {
				fit() {
					fits += 1;
					const term = terminals[0];
					term.cols = term.options.fontFamily === "Initial Terminal" ? 80 : 100;
				}
			},
		},
		"@xterm/xterm": { Terminal: FakeTerminal },
		"@xterm/xterm/css/xterm.css": {},
		react: {
			useEffect: (effect: () => () => void) => effects.push(effect),
			useRef: (value: unknown) => {
				refIndex += 1;
				return { current: refIndex <= 2 ? host : value };
			},
			useState: (value: unknown) => [value, () => {}],
			useCallback: (callback: unknown) => callback,
		},
		"react-dom": {},
		"react/jsx-dev-runtime": { jsxDEV: () => null },
		"react/jsx-runtime": { jsx: () => null, jsxs: () => null },
		"@/components/QuietScrollArea": {},
		"@/lib": { cssColorToHex: () => undefined },
		"../store": {},
		"../transport": { getTransport: () => transport },
		"./ptySizeSync": {
			...ptySizeSync,
			runAfterTerminalRelayout: (
				relayout: () => Promise<unknown>,
				start: () => void,
				bound: ptySizeSync.TerminalRelayoutBound,
			) => {
				deadline = bound.timeoutMs;
				return ptySizeSync.runAfterTerminalRelayout(relayout, start, { ...bound, timeoutMs });
			},
		},
		"./terminalContrast": { terminalContrastFloor: () => 1 },
		"./terminalPrebindBuffer": terminalPrebindBuffer,
	};
	const module = { exports: {} as { default: (props: unknown) => void } };
	runInNewContext(source, {
		module,
		exports: module.exports,
		require: (name: string) => {
			if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
			return modules[name];
		},
		document: { activeElement: null, documentElement: { dataset: {} } },
		Element: class {},
		getComputedStyle: () => ({
			getPropertyValue: (name: string) =>
				name === "--tr-font-family-terminal"
					? family
					: name === "--tr-font-family-code"
						? "Independent Code"
						: "",
		}),
		ResizeObserver: class {
			observe() {}
			disconnect() {}
		},
		requestAnimationFrame: () => 1,
		setTimeout,
		clearTimeout,
	});
	module.exports.default({ tabKey: "tab", workspaceId: "workspace" });
	const cleanup = effects[0]();
	return {
		term: terminals[0],
		terminals,
		calls,
		familyWrites,
		get fits() {
			return fits;
		},
		get watching() {
			return watching;
		},
		get addonDisposed() {
			return addonDisposed;
		},
		get deadline() {
			return deadline;
		},
		releaseFonts,
		cleanup: () => cleanup?.(),
		change(value: string) {
			family = value;
			if (watching) notify();
		},
	};
}

test("terminal family changes fit and resize without replacing the terminal or replay", async () => {
	const fixture = mount();
	try {
		expect(fixture.term.options.fontFamily).toBe("Initial Terminal");
		fixture.releaseFonts();
		await tick();
		const fits = fixture.fits;
		const writes = fixture.familyWrites.length;
		fixture.change("Initial Terminal");
		expect(fixture.fits).toBe(fits);
		expect(fixture.familyWrites).toHaveLength(writes);
		fixture.change("System Mono");
		await tick();
		expect(fixture.term.options.fontFamily).toBe("System Mono");
		expect(fixture.fits).toBe(fits + 1);
		expect(fixture.calls.map((call) => call.method)).toEqual([
			"terminal.attach",
			"terminal.resize",
		]);
		expect(fixture.calls[1].params).toEqual({ id: "pty", cols: 100, rows: 24 });
		expect(fixture.term.output).toBe("existing output");
		expect(fixture.terminals).toHaveLength(1);
	} finally {
		fixture.cleanup();
	}
	expect(fixture.watching).toBe(false);
	expect(fixture.term.disposed).toBe(true);
});

test("changes during initial relayout coalesce before attaching with the latest grid", async () => {
	const fixture = mount();
	try {
		await tick();
		fixture.change("First Mono");
		fixture.change("Latest Mono");
		expect(fixture.familyWrites).toEqual([]);
		expect(fixture.calls).toEqual([]);
		fixture.releaseFonts();
		await tick();
		expect(fixture.term.options.fontFamily).toBe("Latest Mono");
		expect(fixture.calls).toEqual([
			{
				method: "terminal.attach",
				params: { workspaceId: "workspace", tabKey: "tab", cols: 100, rows: 24 },
			},
		]);
	} finally {
		fixture.cleanup();
	}
});

test("the four-second deadline neutralizes late font loads and keeps the newest family", async () => {
	const fixture = mount(5);
	try {
		await tick();
		fixture.change("Before Timeout");
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(fixture.deadline).toBe(4000);
		expect(fixture.addonDisposed).toBe(true);
		expect(fixture.term.options.fontFamily).toBe("Before Timeout");
		fixture.change("After Timeout");
		fixture.releaseFonts();
		await tick();
		expect(fixture.term.options.fontFamily).toBe("After Timeout");
		expect(fixture.calls.filter((call) => call.method === "terminal.attach")).toHaveLength(1);
	} finally {
		fixture.cleanup();
	}
});

test("unmount during initial relayout unsubscribes and never attaches", async () => {
	const fixture = mount();
	await tick();
	fixture.cleanup();
	fixture.change("Unmounted Mono");
	fixture.releaseFonts();
	await tick();
	expect(fixture.watching).toBe(false);
	expect(fixture.calls).toEqual([]);
	expect(fixture.familyWrites).toEqual([]);
});
