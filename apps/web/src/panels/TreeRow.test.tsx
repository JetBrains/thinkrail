import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeRow } from "./TreeRow";

const render = (props: Omit<Parameters<typeof TreeRow>[0], "testid" | "treeId" | "level">) =>
	renderToStaticMarkup(<TreeRow testid="row" treeId="src" level={2} {...props} />);

describe("TreeRow accessibility state", () => {
	it("announces whether a folder is expanded", () => {
		expect(render({ kind: "dir", label: "src", expanded: true })).toContain('aria-expanded="true"');
		expect(render({ kind: "dir", label: "src", expanded: false })).toContain(
			'aria-expanded="false"',
		);
		expect(render({ kind: "dir", label: "src" })).toContain('aria-expanded="false"');
	});

	it("does not mark files as expandable", () => {
		expect(render({ kind: "file", label: "a.ts" })).not.toContain("aria-expanded");
	});

	it("marks only the active row as current", () => {
		expect(render({ kind: "file", label: "a.ts", active: true })).toContain('aria-current="true"');
		expect(render({ kind: "file", label: "a.ts" })).not.toContain("aria-current");
	});

	it("is a tree item at its level that toggles a folder and keeps a file open", () => {
		const folder = render({ kind: "dir", label: "src" });
		expect(folder).toContain('role="treeitem"');
		expect(folder).toContain('aria-level="2"');
		expect(folder).toContain('data-tree-toggle="src"');
		expect(folder).not.toContain("data-tree-keep");
		const file = render({ kind: "file", label: "a.ts" });
		expect(file).toContain('data-tree-keep="true"');
		expect(file).not.toContain("data-tree-toggle");
	});
});
