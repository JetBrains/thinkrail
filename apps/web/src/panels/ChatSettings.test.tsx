import { expect, test } from "bun:test";
import {
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSettings, SubagentSettings } from "./ChatSettings";

test("Chat settings shows scrolling mode radio group and all main settings", () => {
	const markup = renderToStaticMarkup(<ChatSettings />);
	// Main settings are present
	expect(markup).toContain("Message order");
	expect(markup).toContain("Composer size");
	expect(markup).toContain("Line width");
	expect(markup).toContain("Fit to pane");
	// Scrolling mode is visible directly (not in Advanced disclosure)
	expect(markup).toContain("Scrolling during responses");
	expect(markup).toContain('data-testid="scrolling-during-responses"');
	// The three scrolling options
	expect(markup).toContain("Follow response");
	expect(markup).toContain("Keep position");
	expect(markup).toContain("Stay at bottom");
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

test("subagent settings show the global default without inventing a workspace override", () => {
	const markup = renderSettings({ globalEnabled: true });

	expect(markup).toContain('data-testid="settings-subagents"');
	expect(markup).toContain('data-testid="subagents-global-toggle"');
	expect(markup).toContain('aria-checked="true"');
	// Without an active workspace, no workspace override row
	expect(markup).not.toContain('data-testid="subagents-workspace-row"');
});

test("an active workspace shows compact radio options for the override", () => {
	const markup = renderSettings({
		globalEnabled: true,
		activeWorkspace: workspace("off"),
	});

	// Workspace override is shown as a row (not disclosure)
	expect(markup).toContain('data-testid="subagents-workspace-row"');
	expect(markup).toContain('data-testid="subagents-workspace-options"');
	// All three options are visible
	expect(markup).toContain("Use global setting");
	expect(markup).toContain("Currently On");
	expect(markup).toContain('data-testid="subagents-workspace-inherit"');
	expect(markup).toContain('data-testid="subagents-workspace-on"');
	expect(markup).toContain('data-testid="subagents-workspace-off"');
});
