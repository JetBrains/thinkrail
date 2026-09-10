import { expect, test } from "bun:test";
import { readWindowChromeAppearance } from "./windowAppearance";

test("opaque computed colors become bounded RGB values with the current scheme", () => {
	expect(
		readWindowChromeAppearance({ backgroundColor: "rgb(18, 52, 86)", colorScheme: "dark" }),
	).toEqual({ backgroundColor: 0x123456, dark: true });
	expect(
		readWindowChromeAppearance({ backgroundColor: "rgba(0, 0, 0, 1)", colorScheme: "light" }),
	).toEqual({ backgroundColor: 0, dark: false });
});

test("translucent headers retain native system backing rather than guessing a backdrop", () => {
	for (const alpha of [0, 0.5]) {
		expect(
			readWindowChromeAppearance({
				backgroundColor: `rgba(18, 52, 86, ${alpha})`,
				colorScheme: "dark",
			}),
		).toEqual({ backgroundColor: null, dark: true });
	}
});

test("native appearance rejects malformed, unbounded and unresolved input", () => {
	for (const payload of [
		null,
		[],
		{ backgroundColor: "rgb(18, 52, 86)" },
		{ backgroundColor: "rgb(18, 52, 86)", colorScheme: "normal" },
		{ backgroundColor: 0, colorScheme: "dark" },
		{ backgroundColor: "url(file:///untrusted)", colorScheme: "dark" },
		{ backgroundColor: "rgb(18, 52, 256)", colorScheme: "dark" },
		{ backgroundColor: "rgb(-1, 52, 86)", colorScheme: "dark" },
		{ backgroundColor: "rgb(NaN, 52, 86)", colorScheme: "dark" },
		{ backgroundColor: "rgba(18, 52, 86, 2)", colorScheme: "dark" },
		{ backgroundColor: "rgba(18, 52, 86, -1)", colorScheme: "dark" },
		{ backgroundColor: "rgb(18, 52, 86, 1)", colorScheme: "dark" },
		{ backgroundColor: "rgba(18, 52, 86)", colorScheme: "dark" },
		{ backgroundColor: " ".repeat(100), colorScheme: "dark" },
	]) {
		expect(readWindowChromeAppearance(payload)).toBeNull();
	}
});
