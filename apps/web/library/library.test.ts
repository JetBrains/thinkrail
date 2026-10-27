import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Button, IconButton } from "@thinkrail/ui/button";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { components } from "./content";
import { button } from "./content/button";
import { iconButton } from "./content/iconButton";
import { renderMarkdown, TARGET } from "./scripts/generate-md";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("./examples", import.meta.url));

test("packages/ui/COMPONENTS.md is regenerated from the library content", () => {
	expect(readFileSync(TARGET, "utf8")).toBe(renderMarkdown());
});

describe("examples", () => {
	for (const doc of components)
		test(`${doc.name}: every example file is documented and every documented example exists`, () => {
			const files = readdirSync(join(EXAMPLES, doc.slug))
				.filter((file) => file.endsWith(".tsx"))
				.map((file) => file.replace(/\.tsx$/, ""))
				.sort();
			expect(doc.examples.map((example) => example.id).sort()).toEqual(files);
		});
});

describe("production usages", () => {
	for (const doc of components)
		for (const usage of doc.usages)
			test(`${doc.name}: ${usage.file} uses ${doc.tag}`, () => {
				const path = join(ROOT, usage.file);
				expect(existsSync(path)).toBe(true);
				expect(readFileSync(path, "utf8")).toContain(doc.tag);
			});
});

const unquote = (value: string | undefined) => value?.replace(/^"|"$/g, "");
const attrs = (markup: string) => ({
	variant: markup.match(/data-variant="([^"]+)"/)?.[1],
	size: markup.match(/data-size="([^"]+)"/)?.[1],
	type: markup.match(/type="([^"]+)"/)?.[1],
});
const render = (node: ReturnType<typeof createElement>) =>
	renderToStaticMarkup(createElement(TooltipProvider, null, node));

test("Button defaults match the documented defaults", () => {
	const rendered = attrs(render(createElement(Button, null, "x")));
	expect(rendered.variant).toBe(unquote(button.props.variant.default));
	expect(rendered.size).toBe(unquote(button.props.size.default));
	expect(rendered.type).toBe(unquote(button.nativeProps.type.default));
});

test("IconButton defaults match the documented defaults", () => {
	const rendered = attrs(render(createElement(IconButton, { icon: () => null, label: "x" })));
	expect(rendered.variant).toBe(unquote(iconButton.props.variant.default));
	expect(rendered.size).toBe(unquote(iconButton.props.size.default));
	expect(rendered.type).toBe(unquote(iconButton.nativeProps.type.default));
});
