import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayoutAttention } from "../../lib";
import type { AuxiliaryRailFooterItem } from "./AuxiliaryRail";
import { LAYOUT_TOOLS, toolTab } from "./model";
import type { LayoutToolId, WorkspaceLayoutDocument } from "./types";
import { Workbench, type WorkbenchCenterOverride, type WorkbenchPeek } from "./Workbench";

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

function render(
	peek: WorkbenchPeek | undefined,
	document = layout,
	extra: {
		centerOverride?: WorkbenchCenterOverride;
		leftRailViews?: AuxiliaryRailFooterItem[];
	} = {},
): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Workbench
				workspaceId="w1"
				worktreePath="/repo"
				document={document}
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
				{...extra}
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

describe("the optional right rail", () => {
	const allLeft = (tools: readonly LayoutToolId[]): WorkspaceLayoutDocument => ({
		...layout,
		left: {
			...layout.left,
			groups: [{ id: "left", weight: 1, folded: false, tabs: tools.map((tool) => toolTab(tool)) }],
		},
		right: { visible: false, width: 0.28, groups: [] },
	});

	test("is not rendered while the right side has no pane and no tool restores there", () => {
		const html = render(undefined, allLeft(LAYOUT_TOOLS));
		expect(html).not.toContain('data-testid="right-layout-rail"');
		expect(html).toContain('data-testid="left-layout-rail"');
		expect(html).not.toContain('data-panel-id="layout-right"');
	});

	test("shows a tool that restores to the right as its one unplaced entry", () => {
		const html = render(undefined, allLeft(LAYOUT_TOOLS.filter((tool) => tool !== "files")));
		expect(html).toContain('data-testid="right-layout-rail"');
		expect(html).toContain('data-testid="tool-rail-files"');
	});
});

describe("a center override", () => {
	const withTabs: WorkspaceLayoutDocument = {
		...layout,
		center: {
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: "a.ts", name: "a.ts", path: "a.ts" }],
		},
	};
	const override: WorkbenchCenterOverride = {
		id: "view-center",
		label: "Board view",
		render: () => <span data-view-body="" />,
	};

	test("takes the center region's place while the document keeps its center groups", () => {
		const html = render(peek(true), withTabs, { centerOverride: override });
		expect(html).toMatch(
			/data-testid="center-override" data-region="view-center" data-region-kind="center"/,
		);
		expect(html).toContain("data-view-body");
		expect(html).not.toContain('data-testid="center-group"');
		expect(html).toContain('data-region="peek" data-region-kind="peek" data-open="true"');
		expect(withTabs.center).toEqual({
			kind: "group",
			id: "center",
			tabs: [{ kind: "file", id: "a.ts", name: "a.ts", path: "a.ts" }],
		});
		const plain = render(peek(true), withTabs);
		expect(plain).toContain('data-testid="center-group"');
		expect(plain).not.toContain("center-override");
	});

	test("shows the views' toggles in the left rail after its tools", () => {
		const html = render(undefined, layout, {
			leftRailViews: [
				{ key: "view:board", render: () => <button type="button" data-view-toggle="" /> },
			],
		});
		expect(html.indexOf("data-view-toggle")).toBeGreaterThan(
			html.indexOf('data-testid="tool-rail-projects"'),
		);
	});
});
