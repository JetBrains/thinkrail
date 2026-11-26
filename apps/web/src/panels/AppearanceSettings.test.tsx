import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThemeDescriptor } from "@/themes";
import { ThemeLists, type ThemeModeOption } from "./AppearanceSettings";

const THEMES: ThemeDescriptor[] = [
	{ id: "dark", label: "Dark", order: 0, appearance: "dark", contrast: "normal" },
	{ id: "light", label: "Light", order: 1, appearance: "light", contrast: "normal" },
	{ id: "minimal-dark", label: "Minimal Dark", order: 2, appearance: "dark", contrast: "normal" },
	{
		id: "minimal-light",
		label: "Minimal Light",
		order: 3,
		appearance: "light",
		contrast: "normal",
	},
	{ id: "user.ocean", label: "Ocean", order: 4, appearance: "dark", contrast: "normal" },
];

const DEFAULTS = { light: "light", dark: "dark" } as const;

const render = (mode: ThemeModeOption, selected: { light: string; dark: string }) =>
	renderToStaticMarkup(
		<ThemeLists
			mode={mode}
			themes={THEMES}
			selected={selected}
			defaults={DEFAULTS}
			onSelect={() => {}}
		/>,
	);

const option = (markup: string, id: string) =>
	markup.match(new RegExp(`<button[^>]*data-testid="theme-option-${id}"[^>]*>`))?.[0] ?? "";

describe("the theme lists", () => {
	test("Dark mode shows one cheap list of the dark themes, always open, on the current theme", () => {
		const markup = render("dark", { light: "minimal-dark", dark: "minimal-dark" });
		expect(markup).toContain('data-setting-id="dark-theme"');
		expect(markup).not.toContain('data-setting-id="light-theme"');
		expect(markup).toContain('data-cost="cheap"');
		for (const id of ["dark", "minimal-dark", "user.ocean"]) {
			expect(option(markup, id)).toContain('role="option"');
		}
		expect(markup).not.toContain('data-testid="theme-option-light"');
		expect(option(markup, "minimal-dark")).toContain('aria-selected="true"');
		expect(option(markup, "minimal-dark")).toContain('tabindex="0"');
		expect(option(markup, "dark")).toContain('tabindex="-1"');
		expect(markup).not.toContain("theme-toggle");
		expect(markup).toContain('data-testid="settings-reset-dark-theme"');
	});

	test("Light mode shows only the light list, unchanged on its default theme", () => {
		const markup = render("light", { light: "light", dark: "light" });
		expect(markup).toContain('data-setting-id="light-theme"');
		expect(markup).not.toContain('data-setting-id="dark-theme"');
		expect(option(markup, "light")).toContain('aria-selected="true"');
		expect(markup).not.toContain('data-testid="theme-option-dark"');
		expect(markup).not.toContain("settings-reset-light-theme");
		expect(markup).not.toContain("data-changed");
	});

	test("System mode shows the Light and Dark lists side by side, each with its own Reset", () => {
		const markup = render("system", { light: "light", dark: "user.ocean" });
		expect(markup).toContain("@md:grid-cols-2");
		expect(markup.indexOf('data-setting-id="light-theme"')).toBeLessThan(
			markup.indexOf('data-setting-id="dark-theme"'),
		);
		expect(markup).toContain("When your device is light.");
		expect(markup).toContain("When your device is dark.");
		expect(option(markup, "light")).toContain('aria-selected="true"');
		expect(option(markup, "user.ocean")).toContain('aria-selected="true"');
		expect(markup).not.toContain("settings-reset-light-theme");
		expect(markup).toContain('data-testid="settings-reset-dark-theme"');
		expect(markup).not.toContain("theme-pair-toggle");
	});
});
