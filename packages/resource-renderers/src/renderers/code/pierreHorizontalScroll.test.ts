import { afterEach, expect, test } from "bun:test";
import { connectHorizontalScroll } from "./pierreHorizontalScroll";

const originalResizeObserver = globalThis.ResizeObserver;
afterEach(() => {
	globalThis.ResizeObserver = originalResizeObserver;
});

function fixture() {
	let disconnected = false;
	let resize = () => {};
	globalThis.ResizeObserver = class {
		constructor(callback: ResizeObserverCallback) {
			resize = () => callback([], this);
		}
		observe() {}
		unobserve() {}
		disconnect() {
			disconnected = true;
		}
	};
	class Surface extends EventTarget {
		scrollLeft = 0;
		hidden = false;
		style = { width: "" };
		reads = 0;
		constructor(public limit: number) {
			super();
		}
		get scrollWidth() {
			this.reads++;
			return this.limit + 300;
		}
		get clientWidth() {
			this.reads++;
			return 300;
		}
		scroll(value: number) {
			this.scrollLeft = value;
			this.dispatchEvent(new Event("scroll"));
		}
	}
	const bar = new Surface(1000);
	const short = new Surface(200);
	const wide = new Surface(1000);
	const writes: number[] = [];
	const connection = connectHorizontalScroll(
		bar as unknown as HTMLDivElement,
		bar as unknown as HTMLElement,
		[short, wide] as unknown as HTMLElement[],
		{
			getCodeScrollLeft: () => 0,
			setCodeScrollLeft(value) {
				writes.push(value);
				short.scrollLeft = Math.min(value, short.limit);
				wide.scrollLeft = Math.min(value, wide.limit);
			},
		},
	);
	return {
		bar,
		short,
		wide,
		writes,
		connection,
		resize: () => resize(),
		disconnected: () => disconnected,
	};
}

test("immediate reversals keep absolute authority across unequal column echoes without measuring", () => {
	const f = fixture();
	const reads = [f.bar.reads, f.short.reads, f.wide.reads];
	for (const value of [900, 600, 950, 400, 100]) {
		f.bar.scroll(value);
		expect(f.wide.scrollLeft).toBe(value);
		expect(f.short.scrollLeft).toBe(Math.min(value, 200));
		f.short.dispatchEvent(new Event("scroll"));
		f.wide.dispatchEvent(new Event("scroll"));
		expect(f.bar.scrollLeft).toBe(value);
	}
	expect(f.writes).toEqual([0, 900, 600, 950, 400, 100]);
	expect([f.bar.reads, f.short.reads, f.wide.reads]).toEqual(reads);
	f.connection.release();
});

test("external column input becomes authority and release detaches input and dimensions", () => {
	const f = fixture();
	f.bar.scroll(900);
	f.short.scroll(150);
	expect(f.bar.scrollLeft).toBe(150);
	expect(f.wide.scrollLeft).toBe(150);
	f.wide.scroll(750);
	expect(f.bar.scrollLeft).toBe(750);
	f.connection.measure();
	expect(f.bar.scrollLeft).toBe(750);
	f.connection.release();
	expect(f.disconnected()).toBe(true);
	const count = f.writes.length;
	f.bar.scroll(300);
	f.short.scroll(50);
	expect(f.writes.length).toBe(count);
});

test("layout clamp before ResizeObserver preserves authority without delaying external input", () => {
	const f = fixture();
	f.bar.scroll(900);
	f.short.limit = 100;
	f.short.scroll(100); // Browser clamp arrives before the observer.
	expect(f.bar.scrollLeft).toBe(900);
	expect(f.wide.scrollLeft).toBe(900);
	f.resize();
	expect(f.bar.scrollLeft).toBe(900);
	f.short.scroll(75);
	expect(f.bar.scrollLeft).toBe(75);
	expect(f.wide.scrollLeft).toBe(75);
	// A real input concurrent with another dimension change is not discarded.
	f.bar.scroll(900);
	f.short.limit = 50;
	f.short.scroll(25);
	expect(f.bar.scrollLeft).toBe(25);
	expect(f.wide.scrollLeft).toBe(25);
	f.resize();
	expect(f.bar.scrollLeft).toBe(25);
	f.connection.release();
});
