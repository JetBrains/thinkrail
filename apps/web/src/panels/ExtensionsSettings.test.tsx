import { expect, test } from "bun:test";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionsCatalog } from "./ExtensionsSettings";

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
