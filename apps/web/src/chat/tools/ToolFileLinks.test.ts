import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "../toolRegistry";
import { EditCard } from "./EditCard";
import { ReadCard } from "./ReadCard";
import { WriteCard } from "./WriteCard";

const result = { content: [{ type: "text", text: "ok" }] };

function props(
	toolName: string,
	path: string,
	status: ToolRenderProps["status"] = "done",
): ToolRenderProps & { onOpenFile: (path: string) => void } {
	return {
		toolCallId: `${toolName}-call`,
		toolName,
		args: { path, content: "hello", oldText: "old", newText: "new" },
		result,
		status,
		workspaceRoot: "/repo",
		streaming: false,
		onOpenFile: () => {},
	};
}

function markup(
	Card: (props: ToolRenderProps) => React.ReactNode,
	toolName: string,
	path: string,
	status?: ToolRenderProps["status"],
): string {
	return renderToStaticMarkup(createElement(Card, props(toolName, path, status)));
}

describe("structured tool file links", () => {
	it("opens relative and in-worktree absolute read paths under one canonical relative label", () => {
		const relative = markup(ReadCard, "read", "module-a/../README.md");
		const absolute = markup(ReadCard, "read", "/repo/module-a/SPEC.md");

		expect(relative).toContain('data-testid="tool-file-link"');
		expect(relative).toContain('data-path="README.md"');
		expect(relative).toContain(">README.md</button>");
		expect(absolute).toContain('data-path="module-a/SPEC.md"');
	});

	it("leaves foreign, escaping, URL, and empty read paths as inert selectable text", () => {
		for (const path of ["/tmp/outside.png", "../outside.md", "https://example.com/a.md", ""]) {
			const html = markup(ReadCard, "read", path);
			expect(html).not.toContain('data-testid="tool-file-link"');
			expect(html).toContain('data-testid="tool-file-reference"');
		}
	});

	it("links write and edit receipts only after their mutation settles", () => {
		for (const [Card, toolName] of [
			[WriteCard, "write"],
			[EditCard, "edit"],
		] as const) {
			expect(markup(Card, toolName, "README.md", "running")).not.toContain(
				'data-testid="tool-file-link"',
			);
			expect(markup(Card, toolName, "README.md", "error")).not.toContain(
				'data-testid="tool-file-link"',
			);
			expect(markup(Card, toolName, "README.md", "done")).toContain('data-testid="tool-file-link"');
		}
	});
});
