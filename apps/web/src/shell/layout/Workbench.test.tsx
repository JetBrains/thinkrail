import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/tooltip";
import { reconcileAttention } from "./model";
import type { WorkspaceLayoutDocument } from "./types";
import { Workbench } from "./Workbench";

const DOCUMENT: WorkspaceLayoutDocument = {
	version: 2,
	center: {
		kind: "group",
		id: "center-a",
		tabs: [
			{
				kind: "chat",
				id: "chat-tab",
				name: "Chat",
				sessionId: "session-1",
			},
		],
	},
	left: { visible: false, width: 0.2, groups: [] },
	right: { visible: false, width: 0.2, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

const ATTENTION = reconcileAttention(DOCUMENT, undefined);

function renderWorkbench(
	decorateTabIcon?: Parameters<typeof Workbench>[0]["decorateTabIcon"],
): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Workbench
				document={DOCUMENT}
				attention={ATTENTION}
				maxSideGroups={6}
				maxBottomGroups={3}
				projectionEpoch={1}
				renderTabBody={() => null}
				renderTabAdornment={() => null}
				{...(decorateTabIcon ? { decorateTabIcon } : {})}
				renderToolBody={() => null}
				renderEmptyCenter={() => <div data-testid="empty-center" />}
				renderCenterActions={() => null}
				renderSideMenuActions={() => null}
				onCommit={() => {}}
				onAttentionChange={() => {}}
				onUserNavigation={() => {}}
				readNavigationTick={() => 0}
				onRequestClose={() => {}}
				onNewChat={() => {}}
				onNewTerminal={() => {}}
			/>
		</TooltipProvider>,
	);
}

test("workbench decorates the layout-provided tab icon through the injected callback", () => {
	const markup = renderWorkbench(({ tab, icon }) =>
		tab.kind === "chat" ? <span data-testid="decorated-tab-icon">{icon}</span> : icon,
	);

	expect(markup).toContain('data-testid="decorated-tab-icon"');
	expect(markup.match(/data-testid="decorated-tab-icon"/g)?.length).toBe(1);
});

test("workbench still renders the default icon when no decorator is provided", () => {
	const markup = renderWorkbench();

	expect(markup).not.toContain('data-testid="decorated-tab-icon"');
	expect(markup).toContain('data-layout-tab-id="chat-tab"');
	expect(markup).toContain("size-14 shrink-0");
});
