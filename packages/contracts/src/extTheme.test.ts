import { expect, test } from "bun:test";
import { EXT_THEME_TOKENS, extThemeTokenError, extThemeTokensErrors } from "./extTheme";

test("known tokens cover palette, roles, radius and fonts", () => {
	const tokens: readonly string[] = EXT_THEME_TOKENS;
	for (const token of ["--accent", "--text-default", "--radius-sm", "--tr-font-family-interface"])
		expect(tokens).toContain(token);
	expect(tokens).not.toContain("--color-text-default");
});

test("unknown tokens suggest the nearest known name", () => {
	expect(extThemeTokenError("--color-text-default", "#fff")).toContain(
		'did you mean "--text-default"',
	);
	expect(extThemeTokenError("--backgrond", "#fff")).toContain('did you mean "--background"');
	expect(extThemeTokenError("--totally-unrelated-thing", "#fff")).toStartWith(
		"unknown token; allowed:",
	);
});

test("values are checked per token group", () => {
	expect(extThemeTokenError("--accent", "#ff8800")).toBeUndefined();
	expect(extThemeTokenError("--accent", "oklch(0.7 0.12 60)")).toBeUndefined();
	expect(
		extThemeTokenError("--accent", "color-mix(in srgb, var(--text) 40%, transparent)"),
	).toBeUndefined();
	expect(extThemeTokenError("--radius-sm", "0.5rem")).toBeUndefined();
	expect(extThemeTokenError("--tr-font-family-interface", '"Inter", sans-serif')).toBeUndefined();
	expect(extThemeTokenError("--accent", "12px")).toContain("is not a CSS color");
	expect(extThemeTokenError("--radius-sm", "#fff")).toContain("is not a length");
	expect(extThemeTokenError("--accent", 3)).toBe("value must be a string");
});

test("values can never escape a declaration or fetch", () => {
	for (const value of [
		"red; background: url(x)",
		"url(https://x.test/a.png)",
		"red}body{color:red",
		"red !important",
		"#fff\\66",
		"@import x",
	])
		expect(extThemeTokenError("--accent", value)).toBeDefined();
	expect(extThemeTokenError("--tr-font-family-code", "x; color: red")).toBeDefined();
});

test("errors list every bad entry", () => {
	expect(
		extThemeTokensErrors({ "--accent": "#fff", "--nope": "#fff", "--radius-sm": "big" }),
	).toEqual([
		{ token: "--nope", error: expect.stringContaining("unknown token") },
		{ token: "--radius-sm", error: expect.stringContaining("is not a length") },
	]);
});
