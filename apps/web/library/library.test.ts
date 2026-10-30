import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Button, IconButton } from "@thinkrail/ui/button";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { components, docs } from "./content";
import { button } from "./content/components/button";
import { iconButton } from "./content/components/icon-button";
import { LIVE_BLOCKS, LIVE_LINE } from "./live/names";
import { content, renderOutputs, unknownLinks } from "./scripts/generate-md";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("./examples", import.meta.url));
const CONTENT = fileURLToPath(new URL("./content", import.meta.url));
const SHOWCASE = fileURLToPath(new URL("./showcase", import.meta.url));

test("every generated doc is regenerated from the library content", () => {
	const stale = [...renderOutputs()]
		.filter(([path, markdown]) => {
			const target = join(ROOT, path);
			return (existsSync(target) ? readFileSync(target, "utf8") : "") !== markdown;
		})
		.map(([path]) => path);
	expect(stale).toEqual([]);
});

describe("content", () => {
	const files = [
		...docs.map((page) => page.file),
		...components.flatMap((doc) => (doc.contract ? [doc.contract] : [])),
	];

	test("every authored Markdown file is registered and every registered file exists", () => {
		const authored = readdirSync(CONTENT, { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".md"))
			.sort();
		expect([...new Set(files)].sort()).toEqual(authored);
	});

	test("page slugs are unique across docs and components", () => {
		const slugs = [...docs.map((page) => page.slug), ...components.map((doc) => doc.slug)];
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	for (const file of new Set(files))
		test(`${file}: every live block and page link resolves`, () => {
			const markdown = content(file);
			const blocks = markdown
				.split("\n")
				.map((line) => LIVE_LINE.exec(line)?.[1])
				.filter((name): name is string => name !== undefined);
			expect(blocks.filter((name) => !(name in LIVE_BLOCKS))).toEqual([]);
			expect(unknownLinks(markdown)).toEqual([]);
			for (const [, path] of markdown.matchAll(/\]\(\/([^)]+)\)/g))
				expect(existsSync(join(ROOT, path ?? ""))).toBe(true);
		});

	test("every live block is used by some page", () => {
		const used = files.map(content).join("\n");
		for (const name of Object.keys(LIVE_BLOCKS)) expect(used).toContain(`:::live ${name}`);
	});

	for (const page of docs)
		for (const source of page.sources.filter((entry) => entry.startsWith("apps/")))
			test(`${page.slug}: value source ${source} exists`, () => {
				expect(existsSync(join(ROOT, source.replace(/\*.*$/, "")))).toBe(true);
			});
});

describe("examples", () => {
	for (const doc of components)
		test(`${doc.name}: every example file is documented and every documented example exists`, () => {
			const files = readdirSync(join(EXAMPLES, doc.slug))
				.filter((file) => file.endsWith(".tsx"))
				.map((file) => file.replace(/\.tsx$/, ""))
				.sort();
			expect(doc.examples.map((example) => example.id).sort()).toEqual(files);
			expect(files).toContain(doc.preview);
		});
});

describe("showcases", () => {
	for (const doc of components)
		test(`${doc.name}: every showcase section has its words in the doc`, () => {
			const documented = (doc.sections ?? []).map((section) => section.id);
			const file = join(SHOWCASE, `${doc.slug}.tsx`);
			const source = existsSync(file) ? readFileSync(file, "utf8") : "";
			const rendered = [...source.matchAll(/\{\s*id:\s*"([a-z-]+)",\s*Render:/g)].map(
				(match) => match[1],
			);
			expect(rendered.filter((id) => !documented.includes(id))).toEqual([]);
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
	expect(rendered.type).toBe(unquote(button.nativeProps.props.type.default));
});

test("IconButton defaults match the documented defaults", () => {
	const rendered = attrs(render(createElement(IconButton, { icon: () => null, label: "x" })));
	expect(rendered.variant).toBe(unquote(iconButton.props.variant.default));
	expect(rendered.size).toBe(unquote(iconButton.props.size.default));
	expect(rendered.type).toBe(unquote(iconButton.nativeProps.props.type.default));
});
