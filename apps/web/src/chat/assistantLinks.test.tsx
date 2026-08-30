import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMarkdown, assistantFileTarget } from "./assistantLinks";

describe("assistantFileTarget", () => {
	test("accepts normalized relative paths and absolute paths inside the workspace", () => {
		expect(assistantFileTarget(".thinkrail/context/report.md", "/repo")).toBe(
			".thinkrail/context/report.md",
		);
		expect(assistantFileTarget("docs/../README.md#usage", "/repo")).toBe("README.md");
		expect(assistantFileTarget("/repo/docs/report.md?raw=1", "/repo")).toBe("docs/report.md");
	});

	test("rejects external, fragment, outside-workspace, and context-free targets", () => {
		for (const href of [
			"https://example.com/report",
			"mailto:owner@example.com",
			"//example.com/report",
			"#report",
			"../report.md",
			"/tmp/report.md",
		]) {
			expect(assistantFileTarget(href, "/repo")).toBeNull();
		}
		expect(assistantFileTarget("README.md", undefined)).toBeNull();
	});
});

test("assistant Markdown distinguishes workspace files from ordinary anchors", () => {
	const html = renderToStaticMarkup(
		<AssistantMarkdown
			text={[
				"[report](.thinkrail/context/report.md)",
				"[site](https://example.com/report)",
				"[outside](../report.md)",
			].join("\n\n")}
			workspaceRoot="/repo"
			onOpenFile={() => {}}
		/>,
	);

	expect(html).toContain('data-testid="chat-file-link"');
	expect(html).toContain('data-path=".thinkrail/context/report.md"');
	expect(html.match(/target="_blank"/g)).toHaveLength(2);
	expect(html).toContain('href="https://example.com/report"');
	expect(html).toContain('href="../report.md"');
});
