import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtUiPrompt, PendingExtUiContext } from "./ExtUiPrompt";
import { type ChatRow, type RoutineToolStep, rowsHaveToolCall, type ThinkingStep } from "./rows";
import { ChatTurnView } from "./turns";
import type { ExtUiDialogRequest } from "./types";

const tool = (id: string, toolName: string): RoutineToolStep => ({
	kind: "tool",
	id,
	toolCallId: id,
	toolName,
	args: {},
	tool: undefined,
	dead: false,
	streaming: false,
});

const approval: ExtUiDialogRequest = {
	id: "extui_1",
	sessionId: "s",
	kind: "select",
	title: "Allow linear/create_issue? It may change data.",
	options: ["Deny", "Allow once", "Allow in this chat", "Always allow"],
	toolCallId: "b",
};

const activity: ChatRow = {
	kind: "activity",
	id: "activity:a",
	steps: [
		tool("a", "read"),
		{
			kind: "thinking",
			id: "thinking-1",
			text: "plan the issue",
			streaming: false,
			tools: [tool("b", "mcp__linear__create_issue")],
		},
	],
	live: true,
};

function renderWith(row: ChatRow, request: ExtUiDialogRequest | null): string {
	return renderToStaticMarkup(
		<PendingExtUiContext.Provider
			value={
				request
					? { request, reply: () => {}, draft: () => undefined, rememberDraft: () => {} }
					: null
			}
		>
			<ChatTurnView row={row} agentResponded={false} isFinalAnswer={false} />
		</PendingExtUiContext.Provider>,
	);
}

describe("ExtUiPrompt", () => {
	it("renders a select as one button per option, in order, with no extra Cancel", () => {
		const markup = renderToStaticMarkup(<ExtUiPrompt request={approval} onReply={() => {}} />);
		expect(markup).toContain('data-testid="ext-ui-prompt"');
		expect(markup).toContain("Allow linear/create_issue? It may change data.");
		const labels = [...markup.matchAll(/data-testid="ext-ui-option"[^>]*>([^<]+)</g)].map(
			(match) => match[1],
		);
		expect(labels).toEqual(approval.options);
		expect(markup).not.toContain("ext-ui-cancel");
		expect(markup).toContain("Your input is needed");
		expect(markup).toContain("Sending a chat message cancels this request.");
	});

	it("shows a title's later lines as supporting text and names its fields by the first line", () => {
		const markup = renderToStaticMarkup(
			<ExtUiPrompt
				request={{
					id: "i",
					sessionId: "s",
					kind: "input",
					title: "Paste the code\nIt is shown once the browser sign-in completes.",
				}}
				onReply={() => {}}
			/>,
		);
		const title = markup.match(/id="([^"]+)" data-testid="ext-ui-title"[^>]*>Paste the code</);
		expect(title?.[1]).toBeTruthy();
		expect(markup).toContain(`aria-labelledby="${title?.[1]}"`);
		expect(markup).toMatch(
			/data-testid="ext-ui-detail"[^>]*>It is shown once the browser sign-in completes\.</,
		);
	});

	it("renders confirm, input and editor with Cancel and their submit action", () => {
		const confirm = renderToStaticMarkup(
			<ExtUiPrompt
				request={{
					id: "c",
					sessionId: "s",
					kind: "confirm",
					title: "Run rm?",
					message: "It deletes.",
				}}
				onReply={() => {}}
			/>,
		);
		expect(confirm).toContain("It deletes.");
		expect(confirm).toContain(">Cancel<");
		expect(confirm).toContain(">OK<");
		const input = renderToStaticMarkup(
			<ExtUiPrompt
				request={{ id: "i", sessionId: "s", kind: "input", title: "Paste the code" }}
				onReply={() => {}}
			/>,
		);
		expect(input).toContain('data-testid="ext-ui-input"');
		expect(input).toContain(">Submit<");
		const editor = renderToStaticMarkup(
			<ExtUiPrompt
				request={{ id: "e", sessionId: "s", kind: "editor", title: "Edit", prefill: "draft" }}
				onReply={() => {}}
			/>,
		);
		expect(editor).toContain(">draft</textarea>");
		const remembered = renderToStaticMarkup(
			<ExtUiPrompt
				request={{ id: "e", sessionId: "s", kind: "editor", title: "Edit", prefill: "draft" }}
				draft="user changed draft"
				onReply={() => {}}
			/>,
		);
		expect(remembered).toContain(">user changed draft</textarea>");
	});
});

describe("a dialog about a tool call renders on that tool", () => {
	it("pops the awaiting step out of a collapsed Activity fold, without the rest of the fold", () => {
		const markup = renderWith(activity, approval);
		expect(markup).toContain('data-testid="activity-awaiting-step"');
		expect(markup).toContain('data-tool="mcp__linear__create_issue"');
		expect(markup).toContain('data-testid="ext-ui-prompt"');
		expect(markup).not.toContain("plan the issue");
		expect(markup).not.toContain('data-tool="read"');
	});

	it("leaves the fold untouched when no dialog, or one about another call, is pending", () => {
		for (const request of [null, { ...approval, toolCallId: "elsewhere" }]) {
			const markup = renderWith(activity, request);
			expect(markup).not.toContain("activity-awaiting-step");
			expect(markup).not.toContain("ext-ui-prompt");
		}
	});

	it("shows the prompt on a standalone routine step and on a primary tool card", () => {
		const step = renderWith(
			{ kind: "activity", id: "activity:b", steps: [tool("b", "bash")], live: true },
			approval,
		);
		expect(step).toContain('data-testid="ext-ui-prompt"');
		const card = renderWith({ ...tool("b", "visualize"), kind: "tool" }, approval);
		expect(card).toContain('data-testid="tool-card"');
		expect(card).toContain('data-testid="ext-ui-prompt"');
	});

	it("lists the call's whole input inside the prompt and leaves the tool's fold alone", () => {
		const topic = "a long research topic ".repeat(20).trim();
		const awaited = {
			...tool("b", "mcp__everything__simulate_research_query"),
			args: { topic, ambiguous: false },
		};
		const nested: ChatRow = {
			...activity,
			steps: [tool("a", "read"), { ...(activity.steps[1] as ThinkingStep), tools: [awaited] }],
		};
		const markup = renderWith(nested, {
			...approval,
			toolInput: { topic, ambiguous: false, filter: { state: "open" } },
		});
		const prompt = markup.slice(markup.indexOf('data-testid="ext-ui-prompt"'));
		expect(prompt).toContain('data-testid="ext-ui-tool-input"');
		expect(prompt).toContain(`<dt class="text-text-muted">topic</dt>`);
		expect(prompt).toContain(topic);
		expect(prompt).toContain(">ambiguous</dt>");
		expect(prompt).toContain(">false</dd>");
		expect(prompt).toContain("&quot;state&quot;: &quot;open&quot;");
		expect(markup).toMatch(
			/data-step="tool" data-tool="mcp__everything__simulate_research_query"[^>]*data-expanded="false"/,
		);
	});

	it("lists the input on a docked prompt too, and nothing when the request carries none", () => {
		const docked = renderToStaticMarkup(
			<ExtUiPrompt
				request={{ ...approval, toolCallId: "call/1", toolInput: { path: "/etc/hosts" } }}
				onReply={() => {}}
			/>,
		);
		expect(docked).toContain('data-testid="ext-ui-tool-input"');
		expect(docked).toContain(">/etc/hosts</dd>");
		const bare = renderToStaticMarkup(<ExtUiPrompt request={approval} onReply={() => {}} />);
		expect(bare).not.toContain("ext-ui-tool-input");
	});

	it("finds a call anywhere in the transcript rows, nested thinking included", () => {
		expect(rowsHaveToolCall([activity], "b")).toBe(true);
		expect(rowsHaveToolCall([activity], "a")).toBe(true);
		expect(rowsHaveToolCall([activity], "z")).toBe(false);
		expect(rowsHaveToolCall([{ ...tool("t", "visualize"), kind: "tool" }], "t")).toBe(true);
	});
});
