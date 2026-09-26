import { expect, test } from "bun:test";
import { overlayErrors, parseThemeOverlay } from "./overlay";

test("a stored overlay is accepted only when every token is known and safe", () => {
	const good = { key: "themes/warm", mode: "light", tokens: { "--background": "#fbf5ec" } };
	expect(parseThemeOverlay(good)).toEqual(good);
	expect(parseThemeOverlay({ ...good, mode: "dusk" })).toBeNull();
	expect(parseThemeOverlay({ ...good, tokens: { "--nope": "#fff" } })).toBeNull();
	expect(parseThemeOverlay({ ...good, tokens: { "--accent": "url(x)" } })).toBeNull();
	expect(parseThemeOverlay({ ...good, key: "" })).toBeNull();
	expect(parseThemeOverlay("themes/warm")).toBeNull();
});

test("overlay errors name the token", () => {
	expect(overlayErrors({ key: "k", mode: "dark", tokens: { "--radius-sm": "red" } })).toEqual([
		'--radius-sm: value "red" is not a length such as 6px or 0.5rem',
	]);
});
