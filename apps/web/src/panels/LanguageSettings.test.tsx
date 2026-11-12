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

test("lists System, built-in, local, and broken languages with the folder helpers", () => {
	const markup = render("de", {
		dir: "/home/me/.thinkrail/locales",
		files: [
			{ fileName: "de.json", tag: "de", ok: true, strings: {} },
			{ fileName: "notes.json", tag: null, ok: false, error: "invalid-name" },
		],
	});
	expect(markup).toContain('data-testid="language-system"');
	expect(markup).toContain('data-testid="language-en"');
	expect(markup).toContain("Built-in");
	expect(markup).toContain('data-testid="language-de" data-active="true"');
	expect(markup).toContain("Local file");
	expect(markup).toContain('data-testid="language-broken-notes.json"');
	expect(markup).toContain("isn&#x27;t a language code");
	expect(markup).toContain("/home/me/.thinkrail/locales");
	expect(markup).toContain('data-testid="language-open-folder"');
	expect(markup).toContain('data-testid="language-english-source"');
	expect(markup).toContain('data-testid="language-contribute"');
});

test("a missing selected file shows as an unselectable entry", () => {
	const markup = render("uk", { dir: "/d", files: [] });
	expect(markup).toContain('data-testid="language-missing-uk" data-active="true"');
	expect(markup).toContain("File not found");
});

test("the English source link pins released versions and falls back to main", () => {
	expect(englishSourceUrl("0.3.0-nightly.1")).toBe(
		"https://github.com/JetBrains/thinkrail/blob/v0.3.0-nightly.1/packages/locales/en.json",
	);
	expect(englishSourceUrl("0.0.0")).toContain("/blob/main/");
	expect(englishSourceUrl(null)).toContain("/blob/main/");
});
