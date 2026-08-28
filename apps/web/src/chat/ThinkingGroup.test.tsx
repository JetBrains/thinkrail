import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingGroup } from "./ActivityGroup";

const tool = (id: string, toolName: string) => ({
	kind: "tool" as const,
	id,
	toolCallId: id,
	toolName,
	args: {},
	tool: undefined,
	dead: false,
	streaming: false,
});

describe("ThinkingGroup", () => {
	test("renders a collapsed Thinking disclosure that counts its child tools", () => {
		const tools = [tool("t1", "read"), tool("t2", "bash")];
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:0"
				parentId="activity:a1"
				thought={{
					kind: "thinking",
					id: "a1:thinking:0",
					text: "I should inspect the files first.",
					streaming: false,
					tools,
				}}
				tools={tools}
				live={false}
			/>,
		);

		expect(markup).toContain('data-testid="thinking-group"');
		expect(markup).toContain('data-activity-node-id="a1:thinking:0"');
		expect(markup).toContain('data-activity-node-kind="thinking"');
		expect(markup).toContain('data-activity-parent-id="activity:a1"');
		expect(markup).toContain("data-activity-node-toggle");
		expect(markup).toContain('<span class="shrink-0 text-text-default">Thinking</span>');
		expect(markup).not.toContain(
			'<span class="shrink-0 text-text-default sr-only">Thinking</span>',
		);
		expect(markup).toContain("2 steps · read, bash");
		expect(markup).not.toContain("I should inspect the files first.");
	});

	test("surfaces a standalone bold first line as a normal-weight collapsed summary", () => {
		const tools = [tool("t1", "read")];
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:1"
				thought={{
					kind: "thinking",
					id: "a1:thinking:1",
					text: "**Evaluating formatting process**\n\nI should inspect the formatted file.",
					streaming: false,
					tools,
				}}
				tools={tools}
				live={false}
			/>,
		);

		expect(markup).toContain("Evaluating formatting process");
		expect(markup).toContain('data-testid="thinking-group-headline"');
		expect(markup).not.toContain("<strong");
		expect(markup).toContain('<span class="shrink-0 text-text-default sr-only">Thinking</span>');
		expect(markup).not.toContain("**Evaluating formatting process**");
		expect(markup).not.toContain("I should inspect the formatted file.");
		expect(markup).toContain("1 step · read");
	});

	test("recognizes an underscore-delimited heading after leading blank lines", () => {
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:2"
				thought={{
					kind: "thinking",
					id: "a1:thinking:2",
					text: "\n \r\n__Reviewing formatter output__\r\n\r\nThe output looks consistent.",
					streaming: false,
					tools: [],
				}}
				tools={[]}
				live={false}
			/>,
		);

		expect(markup).toContain("Reviewing formatter output");
		expect(markup).not.toContain("__Reviewing formatter output__");
		expect(markup).not.toContain("The output looks consistent.");
	});

	test("does not treat mixed prose and bold runs as a standalone heading", () => {
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:3"
				thought={{
					kind: "thinking",
					id: "a1:thinking:3",
					text: "**Planning** then reconsidering **\n\nThe plan is still changing.",
					streaming: true,
					tools: [],
				}}
				tools={[]}
				live={true}
			/>,
		);

		expect(markup).not.toContain("Planning** then reconsidering");
		expect(markup).not.toContain("The plan is still changing.");
	});

	test("requires non-whitespace content directly inside the strong delimiters", () => {
		const markup = renderToStaticMarkup(
			<ThinkingGroup
				id="a1:thinking:4"
				thought={{
					kind: "thinking",
					id: "a1:thinking:4",
					text: "** Not actually strong **\n\nThis is ordinary reasoning.",
					streaming: false,
					tools: [],
				}}
				tools={[]}
				live={false}
			/>,
		);

		expect(markup).not.toContain("Not actually strong");
		expect(markup).not.toContain("This is ordinary reasoning.");
	});

	test("rejects triple-emphasis runs instead of exposing leftover Markdown", () => {
		for (const [id, text] of [
			["stars", "***Evaluating formatter output***"],
			["underscores", "___Evaluating formatter output___"],
		] as const) {
			const markup = renderToStaticMarkup(
				<ThinkingGroup
					id={`a1:thinking:${id}`}
					thought={{
						kind: "thinking",
						id: `a1:thinking:${id}`,
						text: `${text}\n\nThis uses bold italic emphasis.`,
						streaming: false,
						tools: [],
					}}
					tools={[]}
					live={false}
				/>,
			);

			expect(markup).not.toContain("Evaluating formatter output");
			expect(markup).not.toContain("This uses bold italic emphasis.");
		}
	});
});
