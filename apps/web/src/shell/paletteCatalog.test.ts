import { describe, expect, test } from "bun:test";
import type { NativePageZoomAction, Workspace } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { type KeybindingId, keybindingShortcut } from "../keybindings";
import { commandItems } from "../search";
import {
	type LayoutCenterTab,
	type TabAction,
	tabActions,
	toolTab,
	type WorkspaceLayoutDocument,
} from "./layout";
import { buildCommands, type PaletteCatalogDeps } from "./paletteCatalog";

const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "auth",
	branch: "auth",
	baseBranch: "main",
	worktreePath: "/tmp/w1",
};

const noop = () => {};

const readme: LayoutCenterTab = {
	kind: "file",
	id: "readme",
	name: "README.md",
	path: "README.md",
};

const layout: WorkspaceLayoutDocument = {
	version: 2,
	center: {
		kind: "split",
		id: "split",
		direction: "horizontal",
		weights: [0.5, 0.5],
		children: [
			{
				kind: "group",
				id: "center-a",
				tabs: [readme],
				previewTabId: "readme",
			},
			{ kind: "group", id: "center-b", tabs: [] },
		],
	},
	left: {
		visible: true,
		width: 0.2,
		groups: [{ id: "left-a", weight: 1, folded: false, tabs: [toolTab("projects")] }],
	},
	right: { visible: false, width: 0.2, groups: [] },
	bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	toolRestoreTargets: {},
};

function readmeActions(): TabAction[] {
	return tabActions(currentTranslator(), {
		document: layout,
		tab: readme,
		location: { area: "center", groupId: "center-a" },
		preview: true,
		reorder: { previous: undefined, next: undefined },
		maxSideGroups: 6,
		maxBottomGroups: 3,
		canFocusAdjacentGroup: true,
		canRenameChat: false,
		worktreePath: "/tmp/w1",
	});
}

function deps(overrides: Partial<PaletteCatalogDeps> = {}): PaletteCatalogDeps {
	return {
		t: currentTranslator(),
		contextProjectId: "p1",
		canStartChat: false,
		activeWorkspace: workspace,
		editors: [],
		historyAvailable: false,
		findInFilesAvailable: false,
		changesAvailable: true,
		centerGroupCount: 1,
		canCreateProject: true,
		nativeShortcuts: false,
		pageZoom: null,
		readAction: null,
		canSettle: true,
		settled: false,
		settleBlocked: false,
		settingsGroups: [],
		tabActions: [],
		actions: {
			newWorkspace: noop,
			newProjectlessChat: noop,
			openDefaultWorkspace: noop,
			openProject: noop,
			openProjectPath: noop,
			createProject: noop,
			newChat: noop,
			newTerminal: noop,
			toggleLeft: noop,
			toggleRight: noop,
			toggleBottom: noop,
			showTool: noop,
			showFiles: noop,
			focusRegion: noop,
			focusComposer: noop,
			focusProjects: noop,
			focusTerminal: noop,
			focusGroup: noop,
			openHistory: noop,
			findInFiles: noop,
			markRead: noop,
			markUnread: noop,
			settle: noop,
			unsettle: noop,
			reveal: noop,
			copyPath: noop,
			openIn: noop,
			openSettings: noop,
			runTabAction: noop,
		},
		...overrides,
	};
}

function row(id: string, catalog: PaletteCatalogDeps, online = true) {
	return commandItems(catalog.t, buildCommands(catalog), online).find(
		(item) => item.id === `command:${id}`,
	);
}

describe("palette project and Settings commands", () => {
	test("Start a new project appears only on a host that serves project.create; a host path is always offered", () => {
		expect(row("project.create", deps())?.title).toBe("Start a new project…");
		expect(row("project.create", deps({ canCreateProject: false }))).toBeUndefined();
		expect(row("project.openPath", deps())?.title).toBe("Open a path on the host…");
	});

	test("Settings shows the native shortcut only where the native menu owns one", () => {
		expect(row("settings.open", deps())?.shortcut).toBeUndefined();
		expect(row("settings.open", deps({ nativeShortcuts: true }))?.shortcut).toEqual({
			key: ",",
			mod: true,
		});
	});

	test("a chat without a project is offered only where one can start, and repository commands only with a repository", () => {
		expect(row("chat.newProjectless", deps())).toBeUndefined();
		expect(row("chat.newProjectless", deps({ canStartChat: true }))?.title).toBe(
			"New chat without a project",
		);
		expect(row("workspace.new", deps({ contextProjectId: null }))).toBeUndefined();
		expect(row("workspace.openDefault", deps({ contextProjectId: null }))).toBeUndefined();
	});

	test("Find in files is offered only where it has a scope, with the chord it shares with the shell", () => {
		expect(row("files.findInFiles", deps())).toBeUndefined();
		expect(row("files.findInFiles", deps({ findInFilesAvailable: true }))?.shortcut).toEqual({
			key: "F",
			mod: true,
			shift: true,
		});
	});

	test("New workspace shows the chord the browser lets through, Mod+N only on desktop", () => {
		expect(row("workspace.new", deps())?.shortcut).toEqual({ key: "N", mod: true, alt: true });
		expect(row("workspace.new", deps({ nativeShortcuts: true }))?.shortcut).toEqual({
			key: "N",
			mod: true,
		});
	});

	test("every chord-bound command shows its keybinding's shortcut", () => {
		const bound: readonly KeybindingId[] = [
			"workspace.new",
			"files.findInFiles",
			"chat.history",
			"view.toggleLeft",
			"view.toggleRight",
			"view.toggleBottom",
			"view.changes",
			"region.next",
			"region.previous",
			"focus.composer",
			"focus.projects",
			"focus.terminal",
			"focus.group1",
			"tab.close",
			"group.splitRight",
			"tab.moveToNextGroup",
		];
		for (const nativeShortcuts of [false, true]) {
			const catalog = deps({
				historyAvailable: true,
				findInFilesAvailable: true,
				nativeShortcuts,
				tabActions: readmeActions(),
			});
			for (const id of bound) {
				expect(row(id, catalog)?.shortcut).toEqual(
					keybindingShortcut(id, { browser: !nativeShortcuts }),
				);
			}
		}
	});
});

describe("palette focus commands", () => {
	test("region and Projects focus are always offered with their chords", () => {
		const home = deps({ activeWorkspace: null, centerGroupCount: 0 });
		expect(row("region.next", home)?.shortcut).toEqual({ key: "F6" });
		expect(row("region.previous", home)?.shortcut).toEqual({ key: "F6", shift: true });
		expect(row("focus.projects", home)?.shortcut).toEqual({ key: "0", mod: true });
		expect(row("focus.terminal", home)).toBeUndefined();
		expect(row("focus.group1", home)).toBeUndefined();
	});

	test("the chat input needs a chat and the terminal an active workspace", () => {
		expect(row("focus.composer", deps())).toBeUndefined();
		expect(row("focus.composer", deps({ historyAvailable: true }))?.shortcut).toEqual({
			key: "L",
			mod: true,
		});
		expect(row("focus.terminal", deps())?.shortcut).toEqual({ key: "`", ctrl: true });
	});

	test("one group row per existing center group, numbered in visual order", () => {
		const catalog = deps({ centerGroupCount: 2 });
		expect(row("focus.group1", catalog)?.title).toBe("Focus center group 1");
		expect(row("focus.group2", catalog)?.shortcut).toEqual({ key: "2", mod: true });
		expect(row("focus.group3", catalog)).toBeUndefined();
	});

	test("Show Files carries Mod+Shift+E and Show Changes exists only where Changes do", () => {
		const shown: string[] = [];
		const catalog = deps({
			actions: { ...deps().actions, showFiles: (mode) => shown.push(mode) },
		});
		expect(row("view.show.files", catalog)?.shortcut).toEqual({ key: "E", mod: true, shift: true });
		expect(row("view.changes", catalog)?.title).toBe("Show Changes");
		row("view.show.files", catalog)?.run?.();
		row("view.changes", catalog)?.run?.();
		expect(shown).toEqual(["all", "changed"]);
		expect(row("view.changes", deps({ changesAvailable: false }))).toBeUndefined();
	});
});

describe("palette page zoom commands", () => {
	const zoomRows = ["view.zoomIn", "view.zoomOut", "view.zoomReset"] as const;

	test("are offered only where the desktop exposes the page zoom bridge", () => {
		for (const id of zoomRows) expect(row(id, deps())).toBeUndefined();
		const catalog = deps({ pageZoom: { request: noop }, activeWorkspace: null });
		expect(zoomRows.map((id) => row(id, catalog)?.title)).toEqual([
			"Zoom in",
			"Zoom out",
			"Reset zoom",
		]);
	});

	test("show the preload's chords and run the matching request", () => {
		const requested: NativePageZoomAction[] = [];
		const catalog = deps({ pageZoom: { request: (action) => requested.push(action) } });
		expect(zoomRows.map((id) => row(id, catalog)?.shortcut)).toEqual([
			{ key: "=", mod: true },
			{ key: "-", mod: true },
			{ key: "Num 0", mod: true },
		]);
		for (const id of zoomRows) row(id, catalog)?.run?.();
		expect(requested).toEqual(["in", "out", "reset"]);
	});
});

describe("palette Settle availability", () => {
	test("Settle runs for an idle workspace and Keep active replaces it once settled", () => {
		expect(row("workspace.settle", deps())?.disabledReason).toBeUndefined();
		expect(row("workspace.settle", deps({ settled: true }))).toBeUndefined();
		expect(row("workspace.unsettle", deps({ settled: true }))?.disabledReason).toBeUndefined();
	});

	test("Settle is disabled with the tree's reason while an agent works or a chat needs you", () => {
		expect(row("workspace.settle", deps({ settleBlocked: true }))?.disabledReason).toBe(
			"Finish or read the result first",
		);
	});

	test("the offline reason wins over a blocked Settle, and no Settle row exists where it cannot apply", () => {
		expect(row("workspace.settle", deps({ settleBlocked: true }), false)?.disabledReason).toBe(
			currentTranslator()("search.palette.offlineReason"),
		);
		expect(row("workspace.settle", deps({ canSettle: false }))).toBeUndefined();
	});
});

describe("palette active-tab commands", () => {
	test("list what the tab menu offers and can run now, under the Active tab group", () => {
		const catalog = deps({ tabActions: readmeActions() });
		expect(row("tab.close", catalog)?.title).toBe("Close tab");
		expect(row("tab.close", catalog)?.subtitle).toBe("Active tab");
		expect(row("group.splitDown", catalog)?.title).toBe("Split down");
		expect(row("tab.keepPreview", catalog)?.title).toBe("Keep preview");
		expect(row("tab.copyRelativePath", catalog)?.title).toBe("Copy relative path");
		expect(row("tab.moveTo.center-b", catalog)?.title).toBe("Move to center pane (empty)");
		expect(row("tab.focus", catalog)).toBeUndefined();
		expect(row("tab.reorderNext", catalog)).toBeUndefined();
		expect(row("tab.moveToPreviousGroup", catalog)).toBeUndefined();
	});

	test("an unavailable tab command is left out, and a pick runs the workbench's action by id", () => {
		const ran: string[] = [];
		const narrow = readmeActions().map((action) =>
			action.id === "group.splitRight" ? { ...action, unavailable: { label: "no room" } } : action,
		);
		const catalog = deps({
			tabActions: narrow,
			actions: { ...deps().actions, runTabAction: (id) => ran.push(id) },
		});
		expect(row("group.splitRight", catalog)).toBeUndefined();
		row("group.splitDown", catalog)?.run?.();
		row("tab.moveToNextGroup", catalog)?.run?.();
		expect(ran).toEqual(["group.splitDown", "tab.moveToNextGroup"]);
	});
});
