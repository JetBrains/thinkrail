import { describe, expect, it } from "bun:test";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "../ChatActions";
import {
	readStartedWorkspace,
	StartWorkspaceCard,
	startWorkspaceSummary,
} from "./StartWorkspaceCard";

const DETAILS = {
	workspaceId: "w-2",
	projectId: "p-1",
	sessionId: "s-2",
	name: "workspace-2",
	branch: "workspace-2",
	baseBranch: "origin/main",
	model: "anthropic/claude",
	effort: "high",
};

function props(status: ToolRenderProps["status"], result: unknown): ToolRenderProps {
	return {
		toolCallId: "start-call",
		toolName: "start_workspace",
		args: { prompt: "Fix the login redirect\nand add a test" },
		result,
		status,
		streaming: false,
	};
}

function render(node: ReactNode, actions: Partial<ChatActions> | null = null): string {
	return renderToStaticMarkup(
		createElement(ChatActionsContext.Provider, { value: actions as ChatActions | null }, node),
	);
}

describe("StartWorkspaceCard", () => {
	it("reads started-workspace details defensively", () => {
		expect(readStartedWorkspace({ details: DETAILS })).toEqual(DETAILS);
		expect(readStartedWorkspace({ details: { ...DETAILS, model: null } })?.model).toBeNull();
		expect(readStartedWorkspace({ details: { ...DETAILS, sessionId: 3 } })).toBeNull();
		expect(readStartedWorkspace("text")).toBeNull();
	});

	it("summarizes by the prompt's first line", () => {
		expect(startWorkspaceSummary(props("done", undefined))).toBe("Fix the login redirect");
	});

	it("shows the live workspace name and an open action once started", () => {
		const html = render(createElement(StartWorkspaceCard, props("done", { details: DETAILS })), {
			openWorkspace: () => {},
			WorkspaceName: ({ workspaceId }) => `live:${workspaceId}`,
		});
		expect(html).toContain("live:w-2");
		expect(html).toContain('data-testid="start-workspace-open"');
		expect(html).toContain("workspace-2 from origin/main · anthropic/claude · high");
	});

	it("falls back to the started name without chat actions, and shows errors as text", () => {
		const done = render(createElement(StartWorkspaceCard, props("done", { details: DETAILS })));
		expect(done).toContain("workspace-2");
		expect(done).not.toContain("start-workspace-open");
		const failed = render(
			createElement(
				StartWorkspaceCard,
				props("error", { content: [{ type: "text", text: 'Unknown project "x".' }] }),
			),
		);
		expect(failed).toContain("Unknown project");
		expect(failed).not.toContain("start-workspace-open");
	});
});
