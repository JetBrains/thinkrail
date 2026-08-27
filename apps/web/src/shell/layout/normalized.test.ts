import { describe, expect, test } from "bun:test";
import type {
	LayoutCenterTab,
	LayoutTerminalTab,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import { closeLayoutTab, removeLayoutGroup, toolTab } from "./model";
import {
	applyProjectedLayoutDocument,
	projectWorkspaceLayout,
	reconcileWorkspaceView,
	workbenchFrameFromDocument,
	workspaceViewFromDocument,
} from "./normalized";
import {
	BUILTIN_LAYOUT_PRESETS,
	captureWorkbenchPreset,
	instantiateWorkbenchFrame,
} from "./presets";

const file = (id: string): LayoutCenterTab => ({
	kind: "file",
	id,
	name: `${id}.ts`,
	path: `${id}.ts`,
});

const terminal = (id: string): LayoutTerminalTab => ({
	kind: "terminal",
	id,
	name: id,
	tabKey: id,
});

function document(): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: {
			kind: "split",
			id: "split",
			direction: "horizontal",
			weights: [0.4, 0.6],
			children: [
				{ kind: "group", id: "center-a", tabs: [file("a")], previewTabId: "a" },
				{ kind: "group", id: "center-b", tabs: [file("b")] },
			],
		},
		left: {
			visible: true,
			width: 0.2,
			groups: [
				{
					id: "left",
					weight: 1,
					folded: false,
					tabs: [terminal("before-projects"), toolTab("projects"), terminal("after-projects")],
				},
			],
		},
		right: {
			visible: true,
			width: 0.25,
			groups: [{ id: "right", weight: 1, folded: false, tabs: [toolTab("files")] }],
		},
		bottom: {
			visible: true,
			height: 0.3,
			alignment: "center",
			groups: [{ id: "bottom", weight: 1, folded: false, tabs: [] }],
		},
		toolRestoreTargets: {},
	};
}

describe("normalized workbench layout", () => {
	test("round-trips one projected workspace without putting resources in the frame", () => {
		const projected = document();
		const frame = workbenchFrameFromDocument(projected);
		const view = workspaceViewFromDocument(projected);

		expect(JSON.stringify(frame)).not.toContain('"path"');
		expect(JSON.stringify(frame)).not.toContain('"tabKey"');
		expect(frame.left.groups[0]?.tools).toEqual([toolTab("projects")]);
		expect(projectWorkspaceLayout(frame, view)).toEqual(projected);
	});

	test("resource-only changes update one workspace while preserving the singular frame", () => {
		const first = document();
		const frame = workbenchFrameFromDocument(first);
		const firstView = workspaceViewFromDocument(first);
		const second = document();
		if (second.center.kind !== "split") throw new Error("expected center split");
		second.center.children[0] = {
			kind: "group",
			id: "center-a",
			tabs: [file("workspace-b")],
		};
		const secondView = workspaceViewFromDocument(second);
		const closed = closeLayoutTab(projectWorkspaceLayout(frame, firstView), "a").document;
		const next = applyProjectedLayoutDocument(
			{ frame, viewsByWorkspace: { a: firstView, b: secondView } },
			"a",
			closed,
		);

		expect(next.frame).toEqual(frame);
		expect(next.viewsByWorkspace.a?.groups["center-a"]).toBeUndefined();
		expect(next.viewsByWorkspace.b).toEqual(secondView);
		const nextFirstView = next.viewsByWorkspace.a;
		if (!nextFirstView) throw new Error("missing first workspace view");
		expect(projectWorkspaceLayout(next.frame, nextFirstView)).toEqual(closed);
	});

	test("explicit frame-group removal rehomes resources from hidden workspace views", () => {
		const first = document();
		const frame = workbenchFrameFromDocument(first);
		const firstView = workspaceViewFromDocument(first);
		const second = document();
		if (second.center.kind !== "split") throw new Error("expected center split");
		second.center.children[1] = {
			kind: "group",
			id: "center-b",
			tabs: [file("hidden")],
			previewTabId: "hidden",
		};
		const secondView = workspaceViewFromDocument(second);
		const removed = removeLayoutGroup(first, { area: "center", groupId: "center-b" });
		if ("reason" in removed) throw new Error(removed.reason);
		const next = applyProjectedLayoutDocument(
			{ frame, viewsByWorkspace: { a: firstView, b: secondView } },
			"a",
			removed.document,
		);

		const nextSecondView = next.viewsByWorkspace.b;
		if (!nextSecondView) throw new Error("missing second workspace view");
		expect(projectWorkspaceLayout(next.frame, nextSecondView).center).toEqual({
			kind: "group",
			id: "center-a",
			tabs: [file("a"), file("hidden")],
			previewTabId: "a",
		});
	});

	test("preset instantiation mints local frame ids and capture retains empty slots", () => {
		const preset = BUILTIN_LAYOUT_PRESETS[0];
		if (!preset) throw new Error("missing built-in preset");
		const first = instantiateWorkbenchFrame(preset);
		const second = instantiateWorkbenchFrame(preset);

		expect(first.center.id).not.toBe(preset.center.id);
		expect(second.center.id).not.toBe(first.center.id);
		expect(captureWorkbenchPreset(first, "custom", "Custom").bottom.groups).toHaveLength(1);
		expect(captureWorkbenchPreset(first, "custom", "Custom").bottom.groups[0]?.tools).toEqual([]);
	});

	test("reconciliation maps removed auxiliary resources without copying tool placement", () => {
		const previous = document();
		const previousFrame = workbenchFrameFromDocument(previous);
		const view = workspaceViewFromDocument(previous);
		const next = removeLayoutGroup(previous, { area: "left", groupId: "left" });
		expect(next).toEqual({ reason: "Move or hide this group's tabs before removing it." });

		const withoutLeft = {
			...previousFrame,
			left: { ...previousFrame.left, visible: false, groups: [] },
		};
		const reconciled = reconcileWorkspaceView(previousFrame, withoutLeft, view);
		expect(reconciled.groups.bottom?.tabs.map((tab) => tab.id)).toEqual([
			"before-projects",
			"after-projects",
		]);
	});
});
