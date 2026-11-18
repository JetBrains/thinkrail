import { expect, test } from "bun:test";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionsCatalog, withWebOnlyEntries } from "./ExtensionsSettings";
import { nextDisabledPackages } from "./usePiPackages";

const VISUALIZE: ExtensionCatalogEntry = {
	name: "visualize",
	title: "Visualize",
	description: "Lets the agent draw diagrams.",
	enabled: true,
	tools: ["visualize"],
	hasChildExtensions: false,
};

const render = (
	entries: Parameters<typeof ExtensionsCatalog>[0]["entries"],
	disabled: string[] = [],
) =>
	renderToStaticMarkup(
		<ExtensionsCatalog entries={entries} disabled={disabled} onToggle={() => {}} />,
	);

test("lists an extension as a row with its title, description, its tools as text and an enabled switch", () => {
	const markup = render([VISUALIZE]);
	expect(markup).toMatch(
		/data-setting-row="extension-visualize"[^>]*data-testid="extension-row-visualize"/,
	);
	expect(markup).toContain('data-setting-id="bundled-extensions"');
	expect(markup).toContain("Visualize");
	expect(markup).toContain("Lets the agent draw Mermaid diagrams");
	expect(markup).toMatch(
		/Tools: <code data-testid="extension-tool-visualize"[^>]*>visualize<\/code>/,
	);
	expect(markup).toContain('data-testid="extension-toggle-visualize" data-active="true"');
	expect(markup).toContain('aria-label="Enable Visualize"');
	expect(markup).not.toContain("bg-control-bg-selected px-8");
	expect(markup).not.toContain("settings-reset-");
});

test("a switched-off extension is Changed with a Reset that turns it back on", () => {
	const seen: [string, boolean][] = [];
	const markup = renderToStaticMarkup(
		<ExtensionsCatalog
			entries={[{ ...VISUALIZE, tools: ["visualize", "visualize_compare"] }]}
			disabled={["visualize"]}
			onToggle={(name, enabled) => seen.push([name, enabled])}
		/>,
	);
	expect(markup).toContain('data-changed="true"');
	expect(markup).toContain("data-setting-reset");
	expect(markup).toMatch(/visualize<\/code>, <code data-testid="extension-tool-visualize_compare"/);
	expect(seen).toEqual([]);
});

test("a bundled extension's description comes from the catalog; any other shows its own", () => {
	const other = { ...VISUALIZE, name: "third-party", title: "Third party" };
	expect(render([other])).toContain("Lets the agent draw diagrams.");
});

test("the switch follows the synced disabled list, not the catalog's snapshot", () => {
	const markup = render([VISUALIZE], ["visualize"]);
	expect(markup).toContain('data-testid="extension-toggle-visualize" data-active="false"');
	expect(markup).toContain('aria-checked="false"');
});

test("an empty registry renders the empty state", () => {
	const markup = render([]);
	expect(markup).toContain('data-testid="extensions-empty"');
	expect(markup).not.toContain('role="switch"');
});

test("a web-only extension the host catalog lacks gets its own row and switch, without tool chips", () => {
	const entries = withWebOnlyEntries(currentTranslator(), [VISUALIZE]);
	expect(entries.map((entry) => entry.name)).toEqual(["visualize", "hint-mode"]);
	const markup = render(entries, ["hint-mode"]);
	expect(markup).toContain('data-testid="extension-row-hint-mode"');
	expect(markup).toContain("Hint mode");
	expect(markup).toContain("press F outside a text field");
	expect(markup).toContain('data-testid="extension-toggle-hint-mode" data-active="false"');
	expect(markup.split('data-testid="extension-tool-').length).toBe(2);
	const hosted = { ...VISUALIZE, name: "hint-mode", title: "Hint mode", tools: [] };
	expect(withWebOnlyEntries(currentTranslator(), [hosted]).map((entry) => entry.name)).toEqual([
		"hint-mode",
	]);
});

test("loading and failure render no rows, and a failure offers Retry", () => {
	expect(render("loading")).not.toContain("extension-row-");
	const failed = render("failed");
	expect(failed).toContain('data-testid="extensions-failed"');
	expect(failed).not.toContain('role="switch"');
	expect(failed).not.toContain("extensions-retry");
	const retry = renderToStaticMarkup(
		<ExtensionsCatalog entries="failed" disabled={[]} onToggle={() => {}} onRetry={() => {}} />,
	);
	expect(retry).toMatch(/data-testid="extensions-retry"[^>]*>Retry</);
});

const ASK: ExtensionCatalogEntry = {
	name: "ask-user-question",
	title: "Ask user question",
	enabled: true,
	tools: ["ask_user_question"],
	hasChildExtensions: false,
	settings: [{ key: "richPreviews", default: true }],
};

const renderSettings = (
	values: Record<string, Record<string, boolean>>,
	disabled: string[] = [],
	hostHasSettings = true,
) =>
	renderToStaticMarkup(
		<ExtensionsCatalog
			entries={[ASK]}
			disabled={disabled}
			onToggle={() => {}}
			settings={values}
			onSetting={hostHasSettings ? () => {} : undefined}
		/>,
	);

test("a declared extension setting renders as a nested switch, on by its default", () => {
	const markup = renderSettings({});
	expect(markup).toContain('data-testid="extension-setting-ask-user-question-richPreviews"');
	expect(markup).toContain('data-setting-id="rich-previews"');
	expect(markup).not.toContain('data-testid="settings-reset-rich-previews"');
	expect(renderSettings({ "ask-user-question": { richPreviews: false } })).toContain(
		'data-testid="settings-reset-rich-previews"',
	);
	expect(markup).toContain("Rich previews in questions");
	expect(markup).toContain(
		'data-testid="extension-setting-toggle-ask-user-question-richPreviews" data-active="true"',
	);
});

test("the nested switch follows the stored value and is disabled while the extension is off", () => {
	expect(renderSettings({ "ask-user-question": { richPreviews: false } })).toContain(
		'data-testid="extension-setting-toggle-ask-user-question-richPreviews" data-active="false"',
	);
	const off = renderSettings({}, ["ask-user-question"]);
	expect(off).toMatch(
		/data-testid="extension-setting-toggle-ask-user-question-richPreviews"[^>]*disabled=""/,
	);
});

test("an older host without extension settings shows no nested switch", () => {
	expect(renderSettings({}, [], false)).not.toContain("extension-setting-");
});

test("switching a package on clears every key that covers it; off adds only its own", () => {
	const tools = {
		identity: "local:/repo/tools",
		switchKeys: ["local:/repo/tools", "local:project:tools"],
	};
	expect(nextDisabledPackages(["local:project:tools", "npm:other"], tools, true)).toEqual([
		"npm:other",
	]);
	expect(nextDisabledPackages(["npm:other"], tools, false)).toEqual([
		"npm:other",
		"local:/repo/tools",
	]);
	expect(nextDisabledPackages(["local:project:tools"], tools, false)).toEqual([
		"local:/repo/tools",
	]);
});
