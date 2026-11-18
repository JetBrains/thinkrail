import { expect, test } from "bun:test";
import {
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentSettings } from "./SubagentSettings";

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

function render({
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
		<TooltipProvider>
			<SubagentSettings
				protocolVersion={protocolVersion}
				globalEnabled={globalEnabled}
				globalLimit={globalLimit}
				workspace={activeWorkspace ?? null}
				onGlobalEnabledChange={() => {}}
				onWorkspaceEnabledChange={() => {}}
				onGlobalLimitChange={() => undefined}
				onWorkspaceLimitChange={() => {}}
			/>
		</TooltipProvider>,
	);
}

function element(markup: string, testId: string): string {
	const match = markup.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`));
	if (!match) throw new Error(`missing ${testId}`);
	return match[0];
}

test("the block stays hidden against hosts older than the subagent settings protocol", () => {
	const markup = render({ protocolVersion: SUBAGENT_SETTINGS_PROTOCOL_VERSION - 1 });
	expect(markup).toBe("");
});

test("hosts older than the concurrency protocol get only the Allow row", () => {
	const markup = render({
		protocolVersion: SUBAGENT_CONCURRENCY_PROTOCOL_VERSION - 1,
		activeWorkspace: workspace(undefined, 6),
	});
	expect(markup).toContain('data-testid="subagents-global-toggle"');
	expect(markup).toContain('data-testid="subagents-workspace-toggle"');
	expect(markup).not.toContain("Per chat at once");
	expect(markup).not.toContain("subagent-limit-");
});

test("without an active workspace only the global group renders, with the overrides line", () => {
	const markup = render({ globalLimit: 7 });
	expect(element(markup, "subagents-global-toggle")).toContain('aria-checked="true"');
	expect(markup).toContain("Per chat at once");
	expect(markup).toContain('data-setting-id="subagents-allow"');
	expect(markup).toContain('data-setting-id="subagents-per-chat"');
	expect(markup).not.toContain('data-testid="subagents-workspace-heading"');
	expect(markup).not.toContain('data-testid="subagents-workspace-toggle"');
	expect(element(markup, "subagents-workspace-hint")).toBeTruthy();
	expect(markup).toContain("Workspace overrides appear when a workspace is open.");
	const input = element(markup, "subagent-limit-global-input");
	expect(input).toContain('type="text"');
	expect(input).toContain('inputMode="numeric"');
	expect(input).toContain('value="7"');
	expect(input).toContain('tabindex="0"');
});

test("global rows show Changed and Reset only away from the default", () => {
	const reset = { changed: true, onReset: () => {} };
	const changed = renderToStaticMarkup(
		<TooltipProvider>
			<SubagentSettings
				protocolVersion={SUBAGENT_CONCURRENCY_PROTOCOL_VERSION}
				globalEnabled={false}
				globalLimit={6}
				workspace={null}
				globalEnabledReset={reset}
				globalLimitReset={reset}
				onGlobalEnabledChange={() => {}}
				onWorkspaceEnabledChange={() => {}}
				onGlobalLimitChange={() => undefined}
				onWorkspaceLimitChange={() => {}}
			/>
		</TooltipProvider>,
	);
	expect(changed).toContain('data-testid="settings-reset-subagents-allow"');
	expect(changed).toContain('data-testid="settings-reset-subagents-per-chat"');
	expect(render()).not.toContain("settings-reset-");
});

test("an inheriting workspace selects Use global and shows the global value it follows", () => {
	const markup = render({ globalEnabled: false, globalLimit: 5, activeWorkspace: workspace() });
	const group = element(markup, "subagents-workspace-heading");
	expect(group).toMatch(/^<section /);
	expect(markup).toContain("This workspace");
	expect(markup).toContain("Checkout flow follows the global settings");
	expect(element(markup, "subagents-workspace-toggle")).toContain('role="listbox"');
	expect(element(markup, "subagents-workspace-global")).toContain('aria-selected="true"');
	expect(element(markup, "subagents-workspace-on")).toContain('aria-selected="false"');
	expect(markup).toContain("Follows the global setting, now off");
	expect(element(markup, "subagents-workspace-row")).not.toContain("data-changed");
	expect(element(markup, "subagent-limit-workspace-row")).not.toContain("data-changed");
	expect(markup).not.toContain('data-testid="settings-reset-subagents-workspace');
	const input = element(markup, "subagent-limit-workspace-input");
	expect(input).toContain('value=""');
	expect(input).toContain('placeholder="5"');
	expect(input).toContain('disabled=""');
	expect(element(markup, "subagent-limit-global-input")).not.toContain('disabled=""');
});

test("workspace overrides select their value and offer Reset back to the global settings", () => {
	const markup = render({ globalEnabled: false, activeWorkspace: workspace("on", 2) });
	expect(element(markup, "subagents-workspace-on")).toContain('aria-selected="true"');
	expect(element(markup, "subagents-workspace-row")).toContain('data-changed="true"');
	expect(element(markup, "subagent-limit-workspace-row")).toContain('data-changed="true"');
	expect(markup).toContain('data-testid="settings-reset-subagents-workspace"');
	expect(markup).toContain('data-testid="settings-reset-subagents-workspace-limit"');
	const input = element(markup, "subagent-limit-workspace-input");
	expect(input).toContain('value="2"');
	expect(input).not.toContain('disabled=""');
});

test("a workspace forced off disables its limit even when the global setting is on", () => {
	const markup = render({ activeWorkspace: workspace("off") });
	expect(element(markup, "subagents-workspace-off")).toContain('aria-selected="true"');
	expect(element(markup, "subagent-limit-workspace-input")).toContain('disabled=""');
	expect(markup).toContain("Subagents are off in this workspace.");
	expect(element(markup, "subagent-limit-global-input")).not.toContain('disabled=""');
});
