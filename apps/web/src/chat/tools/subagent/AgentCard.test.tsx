import { describe, expect, test } from "bun:test";
import type { DelegationRunDetails, DelegationRunStatus } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCard } from "../../ToolCard";
import "./register";
import { AgentCard, BackgroundAckNote, isBackgroundRunLost } from "./AgentCard";

function details(overrides: Partial<DelegationRunDetails> = {}): DelegationRunDetails {
	return {
		childSessionId: "child-1",
		roleName: "scout",
		task: "map the repo",
		status: "running",
		model: "anthropic/claude-test",
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.01,
			turns: 2,
			contextTokens: 1_000,
		},
		durationMs: 5_000,
		...overrides,
	};
}

function renderAgentToolCard(
	toolCallId: string,
	runStatus: DelegationRunStatus,
	toolStatus: "done" | "error" = "done",
): string {
	return renderToStaticMarkup(
		<ToolCard
			toolCallId={toolCallId}
			toolName="Agent"
			args={{ subagent_type: "scout", task: "map the repo" }}
			tool={{
				status: toolStatus,
				raw: {
					content: [{ type: "text", text: "report" }],
					details: details({ status: runStatus }),
				},
			}}
			streaming={false}
		/>,
	);
}

describe("Agent ToolCard header outcome", () => {
	test("an aborted run wears the warning triangle, never the success check", () => {
		const markup = renderAgentToolCard("agent-outcome-aborted", "aborted");
		expect(markup).toContain('data-outcome="warning"');
		expect(markup).toContain("text-feedback-warning");
		expect(markup).not.toContain("text-feedback-success");
	});

	test("a completed run keeps the green check", () => {
		const markup = renderAgentToolCard("agent-outcome-completed", "completed");
		expect(markup).toContain('data-outcome="success"');
		expect(markup).toContain("text-feedback-success");
	});

	test("an errored run stays red", () => {
		const markup = renderAgentToolCard("agent-outcome-error", "error", "error");
		expect(markup).toContain('data-outcome="error"');
		expect(markup).toContain("text-feedback-error");
	});

	test("a running call carries no outcome yet", () => {
		const markup = renderToStaticMarkup(
			<ToolCard
				toolCallId="agent-outcome-running"
				toolName="Agent"
				args={{ subagent_type: "scout", task: "map the repo" }}
				tool={undefined}
				streaming
			/>,
		);
		expect(markup).not.toContain("data-outcome");
	});
});

describe("AgentCard queued branch", () => {
	test("a live queued run renders the queued line instead of the activity spinner", () => {
		const markup = renderToStaticMarkup(
			<AgentCard
				toolCallId="agent-queued-live"
				toolName="Agent"
				args={{ subagent_type: "scout", task: "map the repo" }}
				result={{
					content: [{ type: "text", text: "queued" }],
					details: details({ status: "queued" }),
				}}
				status="running"
				streaming
			/>,
		);
		expect(markup).toContain("Queued — waiting for a delegation slot…");
		expect(markup).not.toContain('data-testid="agent-activity"');
	});

	test("the card root carries the raw run status", () => {
		const markup = renderToStaticMarkup(
			<AgentCard
				toolCallId="agent-root-status"
				toolName="Agent"
				args={{ subagent_type: "scout", task: "map the repo", run_in_background: true }}
				result={{
					content: [{ type: "text", text: "ack" }],
					details: details({ status: "running" }),
				}}
				status="done"
				streaming={false}
			/>,
		);
		expect(markup).toContain('data-testid="tool-agent"');
		expect(markup).toContain('data-status="running"');
	});
});

describe("background ack note", () => {
	test("the pending note says the run survives a chat Stop and promises the completion", () => {
		const markup = renderToStaticMarkup(<BackgroundAckNote lost={false} />);
		expect(markup).toContain('data-testid="agent-background-ack"');
		expect(markup).toContain('data-status="pending"');
		expect(markup).toContain("keeps running after a chat Stop");
		expect(markup).toContain("completion message lands in this chat");
	});

	test("the lost state stops promising a completion and keeps the transcript offer", () => {
		const markup = renderToStaticMarkup(<BackgroundAckNote lost />);
		expect(markup).toContain('data-status="lost"');
		expect(markup).toContain("No longer running");
		expect(markup).toContain("no completion message will arrive");
		expect(markup).toContain("transcript is still available");
	});

	test("a hydrated non-terminal ack renders the pending note by default", () => {
		const markup = renderToStaticMarkup(
			<AgentCard
				toolCallId="agent-ack-hydrated"
				toolName="Agent"
				args={{ subagent_type: "scout", task: "map the repo", run_in_background: true }}
				result={{
					content: [{ type: "text", text: "ack" }],
					details: details({ status: "running" }),
				}}
				status="done"
				streaming={false}
			/>,
		);
		expect(markup).toContain('data-status="pending"');
	});
});

describe("isBackgroundRunLost", () => {
	test("an absent registry status means the run is lost", async () => {
		expect(await isBackgroundRunLost(async () => undefined, "child-1")).toBe(true);
	});

	test("a live or terminal registry status keeps the promise standing", async () => {
		expect(await isBackgroundRunLost(async () => "running", "child-1")).toBe(false);
		expect(await isBackgroundRunLost(async () => "completed", "child-1")).toBe(false);
	});

	test("a transient probe failure never swaps the note", async () => {
		expect(await isBackgroundRunLost(() => Promise.reject(new Error("offline")), "child-1")).toBe(
			false,
		);
	});
});
