import { expect, test } from "bun:test";
import {
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings, SubagentSettings } from "./ChatSettings";

test("Chat settings renders one two-handle streaming movement control", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
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

function workspace(
	subagentsOverride?: SubagentOverride,
	subagentMaxConcurrentOverride?: number,
): Workspace {
	return {
		id: "ws1",
		projectId: "p1",
		name: "Checkout flow",
		branch: "checkout-flow",
		worktreePath: "/tmp/checkout-flow",
		baseBranch: "main",
		...(subagentsOverride ? { subagentsOverride } : {}),
		...(subagentMaxConcurrentOverride === undefined ? {} : { subagentMaxConcurrentOverride }),
	};
}

function renderSettings({
	protocolVersion = SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	globalEnabled = true,
	globalLimit = 4,
	activeWorkspace,
}: {
	protocolVersion?: number;
	globalEnabled?: boolean;
	globalLimit?: number;
	activeWorkspace?: Workspace;
} = {}): string {
	return renderToStaticMarkup(
		<SubagentSettings
			protocolVersion={protocolVersion}
			globalEnabled={globalEnabled}
			globalLimit={globalLimit}
			workspace={activeWorkspace ?? null}
			onGlobalChange={() => {}}
			onWorkspaceChange={() => {}}
			onGlobalLimitChange={() => {}}
			onWorkspaceLimitChange={() => {}}
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

test("subagent limits stay hidden against hosts older than the concurrency protocol", () => {
	const markup = renderSettings({
		protocolVersion: SUBAGENT_CONCURRENCY_PROTOCOL_VERSION - 1,
		activeWorkspace: workspace(undefined, 6),
	});

	expect(markup).toContain('data-testid="subagents-global-toggle"');
	expect(markup).not.toContain('data-testid="subagent-limit-global"');
	expect(markup).not.toContain('data-testid="subagent-limit-workspace"');
});

test("the global limit shows its current value with the contract bounds", () => {
	const markup = renderSettings({ globalLimit: 7 });

	expect(markup).toContain('data-testid="subagent-limit-global"');
	expect(markup).toMatch(
		/min="1" max="16"[^>]*data-testid="subagent-limit-global-input"[^>]*value="7"/,
	);
	expect(markup).not.toContain('data-testid="subagent-limit-workspace"');
});

test("a workspace without a limit override follows the global one and hides the input", () => {
	const markup = renderSettings({ globalLimit: 5, activeWorkspace: workspace() });

	expect(markup).toContain('data-testid="subagent-limit-workspace-inherit" data-active="true"');
	expect(markup).toContain("Currently 5");
	expect(markup).not.toContain('data-testid="subagent-limit-workspace-input"');
});

test("a workspace limit override selects Custom and edits its own value", () => {
	const markup = renderSettings({ globalLimit: 5, activeWorkspace: workspace(undefined, 2) });

	expect(markup).toContain('data-testid="subagent-limit-workspace-custom" data-active="true"');
	expect(markup).toMatch(/data-testid="subagent-limit-workspace-input"[^>]*value="2"/);
});
