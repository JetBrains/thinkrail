import { expect, test } from "bun:test";
import {
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
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
		<SubagentSettings
			protocolVersion={protocolVersion}
			globalEnabled={globalEnabled}
			globalLimit={globalLimit}
			workspace={activeWorkspace ?? null}
			onGlobalEnabledChange={() => {}}
			onWorkspaceEnabledChange={() => {}}
			onGlobalLimitChange={() => {}}
			onWorkspaceLimitChange={() => {}}
		/>,
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

test("without an active workspace the table has only the Global column", () => {
	const markup = render({ globalLimit: 7 });
	expect(markup).toContain(">Global</th>");
	expect(markup).not.toContain('data-testid="subagents-workspace-heading"');
	expect(markup).not.toContain('data-testid="subagents-workspace-toggle"');
	const input = element(markup, "subagent-limit-global-input");
	expect(input).toContain('min="1"');
	expect(input).toContain('max="16"');
	expect(input).toContain('value="7"');
});

test("an inheriting workspace mirrors the global values and marks them Global", () => {
	const markup = render({ globalEnabled: false, globalLimit: 5, activeWorkspace: workspace() });
	expect(element(markup, "subagents-workspace-heading")).toContain('title="Checkout flow"');
	expect(element(markup, "subagents-workspace-toggle")).toContain('aria-checked="false"');
	expect(element(markup, "subagents-workspace-source")).toContain('data-source="global"');
	expect(element(markup, "subagent-limit-workspace-source")).toContain('data-source="global"');
	const input = element(markup, "subagent-limit-workspace-input");
	expect(input).toContain('value=""');
	expect(input).toContain('placeholder="5"');
	expect(input).toContain('disabled=""');
	expect(element(markup, "subagent-limit-global-input")).toContain('disabled=""');
	expect(markup).not.toContain('<button type="button" data-testid="subagents-workspace-source"');
	expect(element(markup, "subagent-limit-workspace-source")).toMatch(/^<span /);
});

test("workspace overrides show their own values as Custom tags that reset", () => {
	const markup = render({ globalEnabled: false, activeWorkspace: workspace("on", 2) });
	expect(element(markup, "subagents-workspace-toggle")).toContain('aria-checked="true"');
	expect(element(markup, "subagents-workspace-source")).toContain('data-source="custom"');
	expect(element(markup, "subagent-limit-workspace-source")).toContain('data-source="custom"');
	const input = element(markup, "subagent-limit-workspace-input");
	expect(input).toContain('value="2"');
	expect(input).not.toContain('disabled=""');
	for (const testId of ["subagents-workspace-source", "subagent-limit-workspace-source"]) {
		const tag = element(markup, testId);
		expect(tag).toMatch(/^<button /);
		expect(tag).toContain("use the global subagent");
	}
});

test("a workspace forced off disables its limit even when the global column is on", () => {
	const markup = render({ activeWorkspace: workspace("off") });
	expect(element(markup, "subagents-workspace-toggle")).toContain('aria-checked="false"');
	expect(element(markup, "subagent-limit-workspace-input")).toContain('disabled=""');
	expect(element(markup, "subagent-limit-global-input")).not.toContain('disabled=""');
});
