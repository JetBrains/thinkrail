import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMarkdown, assistantFileTarget, assistantUrlTransform } from "./assistantLinks";

describe("assistantFileTarget", () => {
	test("accepts normalized relative paths and absolute paths inside the workspace", () => {
		expect(assistantFileTarget(".thinkrail/context/report.md", "/repo")).toBe(
			".thinkrail/context/report.md",
		);
		expect(assistantFileTarget("docs/../README.md#usage", "/repo")).toBe("README.md");
		expect(assistantFileTarget("reports/manual%20report.md", "/repo")).toBe(
			"reports/manual report.md",
		);
		expect(assistantFileTarget("/repo/docs/report.md?raw=1", "/repo")).toBe("docs/report.md");
		expect(assistantFileTarget("c:/repo/docs/Report.md", "C:/Repo")).toBe("docs/Report.md");
	});

	test("rejects external, fragment, outside-workspace, and context-free targets", () => {
		for (const href of [
			"https://example.com/report",
			"mailto:owner@example.com",
			"//example.com/report",
			"#report",
			"../report.md",
			"%2e%2e/report.md",
			"/tmp/report.md",
			"report%E0%A4%A.md",
		]) {
			expect(assistantFileTarget(href, "/repo")).toBeNull();
		}
		expect(assistantFileTarget("README.md", undefined)).toBeNull();
	});
});

test("assistant URL transforms preserve only anchor-shaped Windows paths", () => {
	const anchor = { tagName: "a" };
	expect(assistantUrlTransform("C:/repo/report.md", "href", anchor)).toBe("C:/repo/report.md");
	expect(assistantUrlTransform("C:%5Crepo%5Creport.md", "href", anchor)).toBe(
		"C:%5Crepo%5Creport.md",
	);
	expect(assistantUrlTransform("C:/repo/image.png", "src", { tagName: "img" })).toBe("");
	expect(assistantUrlTransform("C:/repo/style.css", "href", { tagName: "link" })).toBe("");
	expect(assistantUrlTransform("javascript:alert(1)", "href", anchor)).toBe("");
	expect(assistantUrlTransform("https://example.com/report", "href", anchor)).toBe(
		"https://example.com/report",
	);
});

test("assistant Markdown distinguishes workspace files from ordinary anchors", () => {
	const html = renderToStaticMarkup(
		<AssistantMarkdown
			text={[
				"[report](<.thinkrail/context/manual report.md>)",
				"[site](https://example.com/report)",
				"[outside](../report.md)",
			].join("\n\n")}
			workspaceRoot="/repo"
			onOpenFile={() => {}}
		/>,
	);

	expect(html).toContain('<button type="button" data-testid="chat-file-link"');
	expect(html).toContain('data-path=".thinkrail/context/manual report.md"');
	expect(html).not.toContain('href=".thinkrail/context/manual%20report.md"');
	expect(html.match(/target="_blank"/g)).toHaveLength(2);
	expect(html).toContain('href="https://example.com/report"');
	expect(html).toContain('href="../report.md"');
});

test("assistant Markdown opens contained Windows paths without exposing unsafe URLs", () => {
	const html = renderToStaticMarkup(
		<AssistantMarkdown
			text={[
				"[inside](c:/repo/docs/Report.md)",
				"[inside backslash](c:\\REPO\\docs\\backslash.md)",
				"[outside](D:/other/report.md)",
				"[unsafe](javascript:alert(1))",
			].join("\n\n")}
			workspaceRoot="C:/Repo"
			onOpenFile={() => {}}
		/>,
	);

	expect(html.match(/data-testid="chat-file-link"/g)).toHaveLength(2);
	expect(html).toContain('data-path="docs/Report.md"');
	expect(html).toContain('data-path="docs/backslash.md"');
	expect(html).not.toContain('href="c:/repo/docs/Report.md"');
	expect(html).not.toContain('href="c:%5CREPO%5Cdocs%5Cbackslash.md"');
	expect(html).not.toContain('href="D:/other/report.md"');
	expect(html).not.toContain('href="javascript:alert(1)"');
});
