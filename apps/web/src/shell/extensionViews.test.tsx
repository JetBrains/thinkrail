import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extensionViews, findExtensionView } from "../extensions";
import { renderPanelChat } from "./ExtensionPanelBody";
import { railViewItems } from "./extensionEntryPoints";
import { centerNavigation, viewArrangement, viewSideToolIds } from "./extensionViews";
import { SessionChatView } from "./SessionChatView";

describe("extension views in the shell", () => {
	test("arrange Board view's own tools on the left and at the bottom, and offer them nowhere else", () => {
		const view = findExtensionView("board:board");
		if (!view) throw new Error("Board view is not declared");
		expect(viewArrangement(view)).toEqual({
			left: "ext:board:nav",
			bottom: "ext:board:activity",
			leftWidth: 0.16,
			bottomHeight: 0.26,
		});
		expect([...viewSideToolIds()].sort()).toEqual(["ext:board:activity", "ext:board:nav"]);
	});

	test("give each view one rail toggle, pressed only while that view is on", () => {
		const control = { tabIndex: 0, onFocus: () => {} };
		const markup = (activeId: string | null) =>
			renderToStaticMarkup(
				<TooltipProvider>
					{railViewItems(extensionViews(), activeId).map((item) => (
						<span key={item.key}>{item.render(control)}</span>
					))}
				</TooltipProvider>,
			);
		expect(railViewItems(extensionViews(), null).map((item) => item.key)).toEqual([
			"view:board:board",
		]);
		expect(markup("board:board")).toMatch(
			/data-testid="view-rail-board:board"[^>]*aria-pressed="true"/,
		);
		expect(markup(null)).toMatch(/data-testid="view-rail-board:board"[^>]*aria-pressed="false"/);
	});

	test("count the active workspace's center navigation, which a center open the user asks for advances", () => {
		const frame = {
			version: 1 as const,
			center: { kind: "group" as const, id: "c1" },
			left: { visible: true, width: 0.2, groups: [] },
			right: { visible: true, width: 0.2, groups: [] },
			bottom: { visible: false, height: 0.3, alignment: "center" as const, groups: [] },
			toolRestoreTargets: {},
		};
		const state = (clocks: Record<string, number>) => ({
			activeWorkspaceId: "A",
			workbenchFrame: frame,
			layoutAttentionByWorkspace: { A: { navigationClockByGroup: clocks } },
		});
		expect(centerNavigation(state({ c1: 2, left: 9 }))).toBe(2);
		expect(centerNavigation({ ...state({ c1: 2 }), activeWorkspaceId: null })).toBe(0);
	});
});

describe("PanelHost.renderChat's chat", () => {
	test("mounts the session's own chat view, a restoring region until its runtime is hydrated", () => {
		const element = renderPanelChat({ workspaceId: "w2", sessionId: "s2" });
		if (!isValidElement(element)) throw new Error("renderChat rendered no element");
		expect(element.type).toBe(SessionChatView);
		expect(element.props).toEqual({ workspaceId: "w2", sessionId: "s2" });
		expect(renderToStaticMarkup(element)).toMatch(
			/data-testid="session-chat" data-session-id="s2" data-state="loading"/,
		);
	});
});
