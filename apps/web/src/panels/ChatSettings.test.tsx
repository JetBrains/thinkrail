import { expect, test } from "bun:test";
import {
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings, SubagentSettings } from "./ChatSettings";

function renderChatSettings(
	todoViewMode: "chat-popover" | "side-tool" = "chat-popover",
	todoViewModeDisabled = false,
) {
	return renderToStaticMarkup(
		<ChatSettings
			todoViewMode={todoViewMode}
			todoViewModeDisabled={todoViewModeDisabled}
			onTodoViewModeChange={() => {}}
		/>,
	);
}

test("Chat settings renders the controlled TODO view choices with the compatibility default", () => {
	const markup = renderChatSettings();
	expect(markup).toContain("TODO view");
	expect(markup).toContain("Chat popover");
	expect(markup).toContain("Open the TODO list below each chat header");
	expect(markup).toContain("Side tab");
	expect(markup).toContain("Follow the latest focused chat in a movable TODO tool");
	expect(markup).toContain('data-testid="todo-view-chat-popover" data-active="true"');
	expect(markup).toContain('data-testid="todo-view-side-tool" data-active="false"');

	const sideMarkup = renderChatSettings("side-tool");
	expect(sideMarkup).toContain('data-testid="todo-view-chat-popover" data-active="false"');
	expect(sideMarkup).toContain('data-testid="todo-view-side-tool" data-active="true"');
});

test("TODO view choices stay controlled and disabled before local layout hydration", () => {
	const markup = renderChatSettings("chat-popover", true);
	expect(markup).toContain('data-testid="todo-view-chat-popover" data-active="true"');
	expect(markup.match(/type="radio"[^>]*disabled=""/g)).toHaveLength(2);
});

test("Chat settings renders one two-handle streaming movement control", () => {
	const markup = renderChatSettings();
	expect(markup).toContain("Streaming response movement");
	expect(markup).toContain(
		"Choose when the chat moves while an answer grows and where its newest edge lands.",
	);
	expect(markup).toContain('data-testid="streaming-response-movement"');
	expect(markup).toContain('data-testid="streaming-movement-settle" aria-label="Settle position"');
	expect(markup).toContain('aria-valuetext="75% from the top"');
	expect(markup).toContain(
		'data-testid="streaming-movement-trigger" aria-label="Trigger position"',
	);
	expect(markup).toContain('aria-valuetext="100% from the top"');
	expect(markup.match(/type="range"/g)).toHaveLength(2);
});

function workspace(subagentsOverride?: SubagentOverride): Workspace {
	return {
		id: "ws1",
		projectId: "p1",
		name: "Checkout flow",
		branch: "checkout-flow",
		worktreePath: "/tmp/checkout-flow",
		baseBranch: "main",
		...(subagentsOverride ? { subagentsOverride } : {}),
	};
}

function renderSettings({
	protocolVersion = SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	globalEnabled = true,
	activeWorkspace,
}: {
	protocolVersion?: number;
	globalEnabled?: boolean;
	activeWorkspace?: Workspace;
} = {}): string {
	return renderToStaticMarkup(
		<SubagentSettings
			protocolVersion={protocolVersion}
			globalEnabled={globalEnabled}
			workspace={activeWorkspace ?? null}
			onGlobalChange={() => {}}
			onWorkspaceChange={() => {}}
		/>,
	);
}

test("subagent controls stay hidden against hosts older than their protocol", () => {
	const markup = renderSettings({
		protocolVersion: SUBAGENT_SETTINGS_PROTOCOL_VERSION - 1,
		activeWorkspace: workspace("off"),
	});

	expect(markup).not.toContain('data-testid="settings-subagents"');
});

test("subagent settings show the global default without inventing a local control", () => {
	const markup = renderSettings({ globalEnabled: true });

	expect(markup).toContain('data-testid="settings-subagents"');
	expect(markup).toContain('data-testid="subagents-global-toggle"');
	expect(markup).toContain('aria-checked="true"');
	expect(markup).not.toContain('data-testid="subagents-workspace-options"');
});

test("an active workspace shows its named three-state override", () => {
	const markup = renderSettings({
		globalEnabled: true,
		activeWorkspace: workspace("off"),
	});

	expect(markup).toContain("This workspace — Checkout flow");
	expect(markup).toContain('data-testid="subagents-workspace-options"');
	expect(markup).toContain('data-testid="subagents-workspace-inherit"');
	expect(markup).toContain('data-testid="subagents-workspace-on"');
	expect(markup).toContain('data-testid="subagents-workspace-off"');
	expect(markup).toContain('data-testid="subagents-workspace-off" data-active="true"');
});
