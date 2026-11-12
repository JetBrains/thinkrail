import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeRow } from "./TreeRow";

const render = (props: Parameters<typeof TreeRow>[0]) =>
	renderToStaticMarkup(<TreeRow {...props} />);

describe("TreeRow accessibility state", () => {
	it("announces whether a folder is expanded", () => {
		expect(render({ testid: "row", kind: "dir", label: "src", expanded: true })).toContain(
			'aria-expanded="true"',
		);
		expect(render({ testid: "row", kind: "dir", label: "src", expanded: false })).toContain(
			'aria-expanded="false"',
		);
		expect(render({ testid: "row", kind: "dir", label: "src" })).toContain('aria-expanded="false"');
	});

	it("does not mark files as expandable", () => {
		expect(render({ testid: "row", kind: "file", label: "a.ts" })).not.toContain("aria-expanded");
	});

	it("marks only the active row as current", () => {
		expect(render({ testid: "row", kind: "file", label: "a.ts", active: true })).toContain(
			'aria-current="true"',
		);
		expect(render({ testid: "row", kind: "file", label: "a.ts" })).not.toContain("aria-current");
	});
});
