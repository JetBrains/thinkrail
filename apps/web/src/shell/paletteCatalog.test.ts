import { describe, expect, test } from "bun:test";
import type { Workspace } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { commandItems } from "../search";
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

function deps(overrides: Partial<PaletteCatalogDeps> = {}): PaletteCatalogDeps {
	return {
		t: currentTranslator(),
		contextProjectId: "p1",
		activeWorkspace: workspace,
		editors: [],
		historyAvailable: false,
		canCreateProject: true,
		nativeShortcuts: false,
		readAction: null,
		canSettle: true,
		settled: false,
		settleBlocked: false,
		settingsGroups: [],
		actions: {
			newWorkspace: noop,
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
			openHistory: noop,
			markRead: noop,
			markUnread: noop,
			settle: noop,
			unsettle: noop,
			reveal: noop,
			copyPath: noop,
			openIn: noop,
			openSettings: noop,
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

	test("New workspace shows the chord the browser lets through, Mod+N only on desktop", () => {
		expect(row("workspace.new", deps())?.shortcut).toEqual({ key: "N", mod: true, alt: true });
		expect(row("workspace.new", deps({ nativeShortcuts: true }))?.shortcut).toEqual({
			key: "N",
			mod: true,
		});
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
