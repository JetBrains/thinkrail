import { expect, test } from "bun:test";
import type { LocalLocalesSnapshot } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { englishSourceUrl, LanguagePage } from "./LanguageSettings";

const render = (preference: string, snapshot: LocalLocalesSnapshot | null) =>
	renderToStaticMarkup(
		<LanguagePage
			preference={preference}
			snapshot={snapshot}
			appVersion={null}
			systemLanguages={["en-US"]}
			onSelect={() => {}}
			onCopyFolder={() => {}}
			onRevealFolder={() => {}}
		/>,
	);

const option = (markup: string, testId: string) =>
	markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

test("the interface language is an expensive list choice that waits for Enter", () => {
	const markup = render("system", null);
	expect(markup).toMatch(/<h2[^>]*>Language<\/h2>/);
	expect(markup).toContain('data-setting-id="interface-language"');
	expect(markup).toMatch(
		/role="listbox"[^>]*aria-orientation="vertical"[^>]*data-testid="language-choice"[^>]*data-layout="list"[^>]*data-cost="expensive"/,
	);
	expect(markup).not.toContain('type="radio"');
	const system = option(markup, "language-system");
	expect(system).toContain('role="option"');
	expect(system).toContain('aria-selected="true"');
	expect(system).toContain('tabindex="0"');
	expect(option(markup, "language-en")).toContain('tabindex="-1"');
	expect(markup).not.toContain("Press Enter to apply");
	expect(markup).not.toContain("settings-reset-interface-language");
});

test("lists System, built-in, local, and broken languages with the folder helpers", () => {
	const markup = render("de", {
		dir: "/home/me/.thinkrail/locales",
		files: [
			{ fileName: "de.json", tag: "de", ok: true, strings: {} },
			{ fileName: "notes.json", tag: null, ok: false, error: "invalid-name" },
		],
	});
	expect(option(markup, "language-system")).toContain('aria-selected="false"');
	expect(markup).toContain('data-testid="language-en"');
	expect(markup).toContain("Built-in");
	expect(option(markup, "language-de")).toContain('data-active="true"');
	expect(markup).toContain("Local file");
	expect(option(markup, "language-broken-notes.json")).toContain("disabled");
	expect(markup).toContain("isn&#x27;t a language code");
	expect(markup).toContain('data-setting-id="language-folder"');
	expect(markup).toContain("/home/me/.thinkrail/locales");
	expect(markup).toContain('data-testid="language-open-folder"');
	expect(markup).toContain('data-testid="language-english-source"');
	expect(markup).toMatch(/<a[^>]*data-testid="language-contribute"[^>]*tabindex="0"/);
	expect(markup).toContain('data-testid="settings-reset-interface-language"');
});

test("a missing selected file shows as an unselectable entry", () => {
	const markup = render("uk", { dir: "/d", files: [] });
	const missing = option(markup, "language-missing-uk");
	expect(missing).toContain('data-active="true"');
	expect(missing).toContain("disabled");
	expect(markup).toContain("File not found");
});

test("the English source link pins released versions and falls back to main", () => {
	expect(englishSourceUrl("0.3.0-nightly.1")).toBe(
		"https://github.com/JetBrains/thinkrail/blob/v0.3.0-nightly.1/packages/locales/en.json",
	);
	expect(englishSourceUrl("0.0.0")).toContain("/blob/main/");
	expect(englishSourceUrl(null)).toContain("/blob/main/");
});
