import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayoutAttention } from "../../lib";
import { toolTab } from "./model";
import type { WorkspaceLayoutDocument } from "./types";
import { Workbench, type WorkbenchPeek } from "./Workbench";

const layout: WorkspaceLayoutDocument = {
	version: 2,
	center: { kind: "group", id: "center", tabs: [] },
	left: {
		visible: true,
		width: 0.2,
		groups: [{ id: "left", weight: 1, folded: false, tabs: [toolTab("projects")] }],
	},
	right: {
		visible: true,
		width: 0.25,
		groups: [{ id: "right", weight: 1, folded: false, tabs: [toolTab("files")] }],
	},
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

const attention: LayoutAttention = {
	selectedByGroup: {},
	lastFocusedCenterGroupId: "center",
	lastFocusedSideGroupId: {},
	navigationClockByGroup: {},
};

const noop = () => {};

function render(peek: WorkbenchPeek | undefined): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Workbench
				workspaceId="w1"
				worktreePath="/repo"
				document={layout}
				attention={attention}
				maxSideGroups={6}
				maxBottomGroups={3}
				projectionEpoch={0}
				renderTabBody={() => null}
				renderTabAdornment={() => null}
				renderToolBody={(tool) => <span data-tool-stub={tool} />}
				renderEmptyCenter={() => null}
				renderCenterActions={() => null}
				onCommit={noop}
				onAttentionChange={noop}
				onUserNavigation={noop}
				readNavigationTick={() => 0}
				onRequestClose={noop}
				onNewChat={noop}
				onNewTerminal={noop}
				{...(peek ? { peek } : {})}
			/>
		</TooltipProvider>,
	);
}

const peek = (open: boolean): WorkbenchPeek => ({
	open,
	width: 0.4,
	onResize: noop,
	render: () => <span data-peek-body="" />,
});

describe("the Workbench's Peek column", () => {
	test("an open Peek is the last outer column and folds the right side and its rail", () => {
		const html = render(peek(true));
		expect(html).toContain('data-panel-id="layout-peek"');
		expect(html).toContain('data-testid="resize-peek"');
		expect(html).toMatch(/data-region="peek" data-region-kind="peek" data-open="true"/);
		expect(html).toContain("data-peek-body");
		expect(html).not.toContain('data-panel-id="layout-right"');
		expect(html).not.toContain('data-testid="right-layout-rail"');
		expect(html).not.toContain('data-tool-stub="files"');
		expect(html.indexOf('data-panel-id="layout-peek"')).toBeGreaterThan(
			html.indexOf('data-panel-id="layout-aligned-column"'),
		);
		expect(layout.right.visible).toBe(true);
	});

	test("a closed Peek keeps its body mounted but hidden and restores the right side", () => {
		const html = render(peek(false));
		expect(html).toContain('data-panel-id="layout-peek"');
		expect(html).toContain("data-peek-body");
		expect(html).not.toContain('data-testid="resize-peek"');
		expect(html).toMatch(/data-region-kind="peek"[^>]*class="[^"]*\bhidden\b/);
		expect(html).toContain('data-panel-id="layout-right"');
		expect(html).toContain('data-testid="right-layout-rail"');
	});

	test("a closed Peek leaves the right side its committed width", () => {
		const rightSize = (html: string) =>
			html.match(/data-panel-id="layout-right" data-panel-size="([\d.]+)"/)?.[1];
		expect(rightSize(render(peek(false)))).toBe("25.0");
		expect(rightSize(render(undefined))).toBe("25.0");
	});

	test("without a peek prop the workbench renders no Peek column", () => {
		const html = render(undefined);
		expect(html).not.toContain("layout-peek");
		expect(html).toContain('data-panel-id="layout-right"');
	});
});
