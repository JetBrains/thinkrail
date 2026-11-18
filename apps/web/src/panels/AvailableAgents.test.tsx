import { expect, test } from "bun:test";
import { SUBAGENT_CATALOG_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { useAppStore } from "@/store";
import { AgentCatalogRows, AvailableAgents } from "./AvailableAgents";
import { SubagentsSettings } from "./SubagentsSettings";
import type { AgentCatalog } from "./useSubagentCatalog";

const render = (catalog: AgentCatalog, disabledNames: string[] = [], disabled = false) =>
	renderToStaticMarkup(
		<TooltipProvider>
			<AgentCatalogRows
				catalog={catalog}
				disabledNames={disabledNames}
				disabled={disabled}
				onChange={() => {}}
				onRefresh={() => {}}
			/>
		</TooltipProvider>,
	);

test("catalog rows show metadata and global accessible switches without hiding disabled roles", () => {
	const markup = render(
		[
			{ name: "worker", description: "Implement a focused task", source: "builtin" },
			{
				name: "cheap-scout",
				description: "Gather context",
				source: "personal",
				model: "openai/example",
				thinking: "low",
			},
			{
				name: "repo-review",
				description: "Repository checks",
				source: "project",
				thinking: "high",
			},
		],
		["worker", "missing-role"],
	);
	expect(markup).toContain("Built-in");
	expect(markup).toContain("Personal");
	expect(markup).toContain("Project");
	expect(markup).toContain("Implement a focused task");
	expect(markup).toContain("Parent model unless selected at invocation");
	expect(markup).toContain("Pinned model");
	expect(markup).toContain('<code class="tr-code-text-small">openai/example</code>');
	expect(markup).toContain("Effort: low");
	expect(markup).toContain("Effort: high");
	expect(markup).toMatch(
		/role="switch"[^>]*aria-checked="false"[^>]*aria-label="Enable worker globally"/,
	);
	expect(markup).toMatch(
		/role="switch"[^>]*aria-checked="true"[^>]*aria-label="Enable cheap-scout globally"/,
	);
	expect(markup).toMatch(/data-changed="true" data-testid="agent-row-worker"/);
	expect(markup).not.toMatch(/data-changed="true" data-testid="agent-row-cheap-scout"/);
	expect(markup).toContain('aria-label="Reset worker to default"');
	expect(markup).not.toContain("missing-role");
	expect(markup).not.toContain("textarea");
});

test("defaults enable all discovered roles and pending saves disable all switches", () => {
	const catalog: AgentCatalog = [
		{ name: "worker", description: "Work", source: "builtin" },
		{ name: "scout", description: "Explore", source: "builtin" },
	];
	expect(render(catalog).match(/aria-checked="true"/g)).toHaveLength(2);
	expect(render(catalog, [], true).match(/disabled=""/g)).toHaveLength(2);
});

test("loading, empty and retryable read failures are explicit", () => {
	expect(render("loading")).toContain('aria-busy="true"');
	expect(render("loading")).toContain("Loading agents…");
	expect(render([])).toContain('data-testid="agents-empty"');
	expect(render("failed")).toContain('data-testid="agents-load-failed"');
	expect(render("failed")).toContain("Retry");
});

test("unsupported or unnegotiated hosts render no agent roster", () => {
	expect(renderToStaticMarkup(<AvailableAgents />)).toBe("");
});

test("capable hosts show the roster on the Subagents page after delegation, with global scope and loading", () => {
	const initial = useAppStore.getInitialState();
	const previous = initial.protocolVersion;
	try {
		initial.protocolVersion = SUBAGENT_CATALOG_PROTOCOL_VERSION;
		const markup = renderToStaticMarkup(
			<TooltipProvider>
				<SubagentsSettings />
			</TooltipProvider>,
		);
		expect(markup.match(/data-testid="settings-subagents"/g)).toHaveLength(1);
		expect(markup.indexOf('data-testid="subagents-global"')).toBeLessThan(
			markup.indexOf('data-testid="settings-agent-catalog"'),
		);
		expect(markup).toMatch(/data-testid="settings-agent-catalog"[\s\S]*data-scope="allProjects"/);
		expect(markup).toContain("ongoing work continues");
		expect(markup).toContain('data-testid="agents-loading"');
		expect(markup).not.toContain("scope to be decided");
	} finally {
		initial.protocolVersion = previous;
	}
});
