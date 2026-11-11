import { expect, test } from "bun:test";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionsCatalog } from "./ExtensionsSettings";
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

test("lists an extension with its title, description, tool chip and an enabled switch", () => {
	const markup = render([VISUALIZE]);
	expect(markup).toContain('data-testid="extension-row-visualize"');
	expect(markup).toContain("Visualize");
	expect(markup).toContain("Lets the agent draw Mermaid diagrams");
	expect(markup).toContain('data-testid="extension-tool-visualize"');
	expect(markup).toContain('data-testid="extension-toggle-visualize" data-active="true"');
	expect(markup).toContain('aria-label="Enable Visualize"');
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

test("loading and failure render no rows", () => {
	expect(render("loading")).not.toContain("extension-row-");
	const failed = render("failed");
	expect(failed).toContain('data-testid="extensions-failed"');
	expect(failed).not.toContain('role="switch"');
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
