import { cc, ptr } from "bun:ffi";
import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { WINDOWS_CHROME_SOURCE } from "../windowChrome";
import { ffiBackgroundColor, windowsChromeSymbols } from "./controller";

function compileNativeTests() {
	return cc({
		source: resolve(import.meta.dir, WINDOWS_CHROME_SOURCE),
		library: ["user32", "gdi32", "dwmapi"],
		define: { WINDOWS_CHROME_TEST: "1" },
		symbols: {
			...windowsChromeSymbols,
			windows_chrome_test_resize: {
				args: ["ptr", "i64", "i32", "i32", "i64", "i32", "i32"],
				returns: "i32",
			},
			windows_chrome_test_fullscreen: { args: ["i64"], returns: "i32" },
			windows_chrome_test_geometry: { args: ["ptr", "u32", "ptr"], returns: "i32" },
			windows_chrome_test_region: {
				args: ["ptr", "i32", "i32", "i32", "i32", "i32"],
				returns: "i32",
			},
			windows_chrome_test_color: { args: ["i32"], returns: "u32" },
			windows_chrome_test_style: { args: ["i64"], returns: "i64" },
		},
	});
}

const framedStyle = 0x00cf0000n;
const restoredRects = [
	[100, 100, 1100, 750],
	[108, 100, 1092, 742],
	[107, 100, 1093, 743],
	[847, 0, 993, 30],
];

function packedPoint(x: number, y: number): bigint {
	return BigInt(x & 0xffff) | (BigInt(y & 0xffff) << 16n);
}

describe.skipIf(process.platform !== "win32" || process.arch !== "x64")(
	"Windows native C without windows or GUI input",
	() => {
		let native: ReturnType<typeof compileNativeTests>;
		beforeAll(() => {
			native = compileNativeTests();
		});

		function geometry(rects: number[][], dpi: number) {
			const output = new Float64Array([-1, -1]);
			const result = native.symbols.windows_chrome_test_geometry(
				ptr(new Int32Array(rects.flat())),
				dpi,
				ptr(output),
			);
			return { result, insets: Array.from(output) };
		}

		test("compiles and links the production exports and rejects invalid/null handles", () => {
			const output = new Float64Array([123, 456]);
			for (const window of [null, 0n, 1n, -1n]) {
				expect(native.symbols.windows_chrome_install(window)).toBe(0);
				for (const generation of [0, 1, 0xffffffff]) {
					expect(native.symbols.windows_chrome_read(window, generation, ptr(output))).toBe(0);
					expect(native.symbols.windows_chrome_read(window, generation, null)).toBe(0);
					expect(native.symbols.windows_chrome_appearance(window, generation, -1, 0)).toBe(0);
					expect(native.symbols.windows_chrome_appearance(window, generation, 0x123456, 1)).toBe(0);
				}
			}
			expect(Array.from(output)).toEqual([123, 456]);
			for (const [color, dark] of [
				[-2, 0],
				[0x1000000, 1],
				[0, -1],
				[0, 2],
			] as const) {
				expect(native.symbols.windows_chrome_appearance(null, 1, color, dark)).toBe(0);
			}
		});

		test("restores only system/minimize/maximize bits and keeps unrelated styles", () => {
			for (const style of [0n, 0x94040000n, 0x38c40000n, framedStyle]) {
				expect(native.symbols.windows_chrome_test_style(style)).toBe(style | 0x000b0000n);
			}
		});

		test("fullscreen matches the SDK predicate even when maximized or minimized bits survive", () => {
			for (const style of [0x80000000n, 0x91000000n, 0xb0000000n]) {
				expect(native.symbols.windows_chrome_test_fullscreen(style)).toBe(1);
			}
			for (const style of [0n, 0x000b0000n, 0x800b0000n, 0x00c00000n, 0x00040000n, framedStyle]) {
				expect(native.symbols.windows_chrome_test_fullscreen(style)).toBe(0);
			}
		});

		test("all eight resize hits use signed screen coordinates and physical border widths", () => {
			const frame = new Int32Array([-1600, -900, -400, -100]);
			const points = [
				[-1599, -899, 13],
				[-1000, -899, 12],
				[-401, -899, 14],
				[-401, -500, 11],
				[-401, -101, 17],
				[-1000, -101, 15],
				[-1599, -101, 16],
				[-1599, -500, 10],
				[-1589, -884, 10],
				[-1588, -884, 0],
				[-1000, -500, 0],
				[-1601, -500, 0],
				[-1000, -901, 0],
				[-400, -500, 0],
				[-1000, -100, 0],
			] as const;
			for (const [x, y, hit] of points) {
				const point = packedPoint(x, y);
				expect(
					native.symbols.windows_chrome_test_resize(ptr(frame), point, 12, 16, framedStyle, 0, 0),
				).toBe(hit);
				for (const [style, zoomed, iconic] of [
					[framedStyle, 1, 0],
					[framedStyle, 0, 1],
					[0n, 0, 0],
					[0x00c00000n, 0, 0],
				] as const) {
					expect(
						native.symbols.windows_chrome_test_resize(
							ptr(frame),
							point,
							12,
							16,
							style,
							zoomed,
							iconic,
						),
					).toBe(0);
				}
			}
		});

		test("caption bounds are translated from window pixels into client CSS pixels", () => {
			expect(geometry(restoredRects, 96)).toEqual({ result: 1, insets: [0, 145] });
			const scaled = geometry(
				[
					[-1500, -450, 0, 525],
					[-1488, -450, -12, 513],
					[-1489, -450, -11, 514],
					[1270, 0, 1490, 45],
				],
				144,
			);
			expect(scaled.result).toBe(1);
			expect(scaled.insets[0]).toBe(0);
			expect(scaled.insets[1]).toBeCloseTo((218 * 96) / 144);
		});

		test("left-side captions and visible-frame clipping contribute to both insets", () => {
			expect(
				geometry(
					[
						[-700, -300, 300, 400],
						[-692, -300, 292, 392],
						[-693, -300, 293, 393],
						[7, 0, 153, 30],
					],
					96,
				),
			).toEqual({ result: 1, insets: [145, 0] });
			expect(
				geometry(
					[
						[-8, -8, 1008, 708],
						[-8, -8, 1008, 700],
						[0, 0, 1000, 700],
						[870, 8, 1008, 38],
					],
					192,
				),
			).toEqual({ result: 1, insets: [4, 73] });
		});

		test("unavailable or empty geometry cannot publish invented safe areas", () => {
			expect(geometry(restoredRects, 0)).toEqual({ result: 0, insets: [-1, -1] });
			for (const index of [1, 2, 3]) {
				const rects = restoredRects.map((rect, i) => (i === index ? [0, 0, 0, 0] : rect));
				expect(geometry(rects, 96)).toEqual({ result: 0, insets: [-1, -1] });
			}
		});

		test("child exclusion uses exact caption bounds and only the restored physical top band", () => {
			const rects = new Int32Array([
				-600, -300, 400, 400, -592, -300, 392, 392, -593, -300, 393, 393, 800, 6, 980, 34,
			]);
			const owns = (x: number, y: number, resize = 1, mirrored = 0) =>
				native.symbols.windows_chrome_test_region(ptr(rects), 12, resize, mirrored, x, y);
			expect(owns(800, 20)).toBe(0);
			expect(owns(791, 20)).toBe(1);
			expect(owns(972, 20)).toBe(1);
			expect(owns(800, 34)).toBe(1);
			expect(owns(200, 11)).toBe(0);
			expect(owns(200, 12)).toBe(1);
			expect(owns(200, 0, 0)).toBe(1);
			expect(owns(800, 5, 0)).toBe(1);
			expect(owns(800, 6, 0)).toBe(0);
			expect(owns(984, 100)).toBe(0);
			expect(owns(-1, 100)).toBe(0);
			expect(owns(20, 20, 1, 1)).toBe(0);
			expect(owns(800, 20, 1, 1)).toBe(1);
		});

		test("DWM/GDI colors normalize boxed RGB, COLORREF byte order, and the OS-default sentinel", () => {
			for (const [rgb, colorref] of [
				[-1, 0xffffffff],
				[0, 0],
				[0x123456, 0x563412],
				[0xff0000, 0x0000ff],
				[0x0000ff, 0xff0000],
				[0xffffff, 0xffffff],
			] as const) {
				for (const boxed of Float64Array.of(rgb)) {
					expect(
						native.symbols.windows_chrome_test_color(
							ffiBackgroundColor(boxed === -1 ? null : boxed),
						),
					).toBe(colorref);
				}
			}
		});
	},
);
