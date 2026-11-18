import { expect, test } from "bun:test";
import {
	ARTIFACTS_PROTOCOL_VERSION,
	type SpecGraphNode,
	type WorkspaceArtifactsSnapshot,
} from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { artifactsWatermark, hostLacksArtifacts, selectArtifactsUnseen } from "../store";
import {
	type ArtifactTreeNode,
	artifactRows,
	artifactTimeLabel,
	artifactTree,
	mentionText,
	type SmartGroup,
	smartGroups,
} from "./artifactsModel";

const snapshot: WorkspaceArtifactsSnapshot = {
	workspaceId: "w1",
	dir: ".thinkrail/context",
	artifacts: [
		{
			path: ".thinkrail/context/mockups/a.html",
			state: "live",
			size: 1,
			changedAt: 30,
			firstSeenAt: 30,
			sessionId: "s1",
		},
		{
			path: ".thinkrail/context/TASK-x.md",
			state: "deleted",
			size: 1,
			changedAt: 20,
			firstSeenAt: 10,
			sessionId: "s2",
		},
		{ path: ".thinkrail/context/notes.md", state: "live", size: 1, changedAt: 5, firstSeenAt: 5 },
	],
	outputs: [
		{
			path: "test-results",
			kind: "dir",
			files: 3,
			filesTruncated: false,
			changedAt: 40,
			sessionId: "s1",
		},
	],
};

const spec = (path: string, status?: string): SpecGraphNode => ({
	id: path,
	type: "task-spec",
	title: path,
	path,
	dependsOn: [],
	references: [],
	implements: [],
	tags: [],
	...(status ? { status } : {}),
});

test("rows carry the name, the folder inside the artifacts folder and a task-spec's status", () => {
	const rows = artifactRows(snapshot, {
		sessionId: null,
		highlightSince: 25,
		showIgnored: true,
		specs: [spec(".thinkrail/context/TASK-x.md", "done")],
	});
	expect(
		rows.artifacts.map(({ name, folder, taskSpecStatus, fresh }) => ({
			name,
			folder,
			taskSpecStatus,
			fresh,
		})),
	).toEqual([
		{ name: "a.html", folder: "mockups", taskSpecStatus: null, fresh: true },
		{ name: "TASK-x.md", folder: "", taskSpecStatus: "done", fresh: false },
		{ name: "notes.md", folder: "", taskSpecStatus: null, fresh: false },
	]);
	expect(rows.outputs?.map((row) => [row.output.path, row.fresh])).toEqual([
		["test-results", true],
	]);
});

test("the chat filter keeps that chat's rows and the toggle hides ignored outputs", () => {
	const rows = artifactRows(snapshot, {
		sessionId: "s2",
		highlightSince: 0,
		showIgnored: false,
		specs: undefined,
	});
	expect(rows.artifacts.map((row) => row.name)).toEqual(["TASK-x.md"]);
	expect(rows.outputs).toBeNull();
	expect(rows.otherChats).toBe(2);
	expect(
		artifactRows(snapshot, {
			sessionId: "s1",
			highlightSince: 0,
			showIgnored: true,
			specs: undefined,
		}).otherChats,
	).toBe(2);
	expect(
		artifactRows(snapshot, {
			sessionId: null,
			highlightSince: 0,
			showIgnored: true,
			specs: undefined,
		}).otherChats,
	).toBe(0);
	expect(
		artifactRows(
			{ ...snapshot, outputs: null },
			{
				sessionId: null,
				highlightSince: 0,
				showIgnored: true,
				specs: undefined,
			},
		).outputs,
	).toBeNull();
});

test("the watermark is the newest arrival, and only something newer than what was seen is unseen", () => {
	expect(artifactsWatermark(snapshot, true)).toBe(40);
	const state = (seen: number | undefined) => ({
		artifactsByWorkspace: { w1: snapshot },
		artifactsSeenByWorkspace: seen === undefined ? {} : { w1: seen },
		artifactsShowIgnored: true,
	});
	expect(selectArtifactsUnseen(state(40), "w1")).toBe(false);
	expect(selectArtifactsUnseen(state(39), "w1")).toBe(true);
	expect(selectArtifactsUnseen(state(undefined), "w2")).toBe(false);
});

test("a change in hidden ignored outputs is not something new", () => {
	const watermark = artifactsWatermark(snapshot, false);
	expect(watermark).toBeLessThan(artifactsWatermark(snapshot, true));
	const state = (artifactsShowIgnored: boolean) => ({
		artifactsByWorkspace: { w1: snapshot },
		artifactsSeenByWorkspace: { w1: watermark },
		artifactsShowIgnored,
	});
	expect(selectArtifactsUnseen(state(false), "w1")).toBe(false);
	expect(selectArtifactsUnseen(state(true), "w1")).toBe(true);
});

test("only a host known to be older lacks artifacts, not one still connecting", () => {
	expect(hostLacksArtifacts(null)).toBe(false);
	expect(hostLacksArtifacts(ARTIFACTS_PROTOCOL_VERSION - 1)).toBe(true);
	expect(hostLacksArtifacts(ARTIFACTS_PROTOCOL_VERSION)).toBe(false);
});

function treeOf(
	paths: readonly (readonly [
		string,
		{ deleted?: boolean; fresh?: boolean; sessionId?: string }?,
	])[],
	sessionId: string | null = null,
): ArtifactTreeNode[] {
	const tree: WorkspaceArtifactsSnapshot = {
		workspaceId: "w1",
		dir: ".thinkrail/context",
		artifacts: paths.map(([path, flags = {}]) => ({
			path: `.thinkrail/context/${path}`,
			state: flags.deleted ? "deleted" : "live",
			size: 1,
			changedAt: 1,
			firstSeenAt: flags.fresh ? 9 : 1,
			...(flags.sessionId ? { sessionId: flags.sessionId } : {}),
		})),
		outputs: null,
	};
	const rows = artifactRows(tree, { sessionId, highlightSince: 5, showIgnored: false, specs: [] });
	return artifactTree(tree.dir, rows.artifacts, tree.artifacts);
}

function outline(nodes: readonly ArtifactTreeNode[]): unknown[] {
	return nodes.map((node) =>
		node.kind === "file"
			? node.name
			: {
					[node.name]: outline(node.children),
					files: node.files,
					...(node.fresh ? { fresh: true } : {}),
					...(node.deleted ? { deleted: true } : {}),
				},
	);
}

test("the tree puts folders first, A to Z, and compacts single-folder chains", () => {
	const nodes = treeOf([
		["notes.md"],
		["TASK-a.md"],
		["mockups/features/_scratch/w1/a.png"],
		["mockups/features/_scratch/w3/b.png", { fresh: true }],
		["mockups/features/index.html"],
		["reports/r.md"],
		["gallery/analyzers/images/x/1.png", { deleted: true }],
		["gallery/analyzers/images/x/2.png", { deleted: true }],
		["gallery/analyzers/images/y.png"],
	]);
	expect(outline(nodes)).toEqual([
		{
			"gallery/analyzers/images": [{ x: ["1.png", "2.png"], files: 2, deleted: true }, "y.png"],
			files: 3,
		},
		{
			"mockups/features": [
				{
					_scratch: [
						{ w1: ["a.png"], files: 1 },
						{ w3: ["b.png"], files: 1, fresh: true },
					],
					files: 2,
					fresh: true,
				},
				"index.html",
			],
			files: 3,
			fresh: true,
		},
		{ reports: ["r.md"], files: 1 },
		"notes.md",
		"TASK-a.md",
	]);
});

test("a folder keeps every folder of its chain and the file rows keep worktree paths", () => {
	const [folder] = treeOf([["a/b/c/d.md"]]);
	if (folder?.kind !== "dir") throw new Error("expected a folder");
	expect(folder.name).toBe("a/b/c");
	expect(folder.path).toBe(".thinkrail/context/a/b/c");
	expect(folder.paths).toEqual([
		".thinkrail/context/a",
		".thinkrail/context/a/b",
		".thinkrail/context/a/b/c",
	]);
	expect(folder.children[0]?.path).toBe(".thinkrail/context/a/b/c/d.md");
});

test("the chat filter reshapes the tree to that chat's folders", () => {
	const paths = [
		["mockups/features/a.png", { sessionId: "s1" }],
		["mockups/onboarding/b.html", { sessionId: "s2" }],
	] as const;
	expect(outline(treeOf(paths))).toEqual([
		{
			mockups: [
				{ features: ["a.png"], files: 1 },
				{ onboarding: ["b.html"], files: 1 },
			],
			files: 2,
		},
	]);
	expect(outline(treeOf(paths, "s1"))).toEqual([{ "mockups/features": ["a.png"], files: 1 }]);
});

test("a folder reads as deleted only when nothing in it lives, whichever chat wrote it", () => {
	const paths = [
		["reports/r1.md", { deleted: true, sessionId: "s1" }],
		["reports/r2.md", { sessionId: "s2" }],
		["old/a.md", { deleted: true, sessionId: "s1" }],
	] as const;
	expect(outline(treeOf(paths, "s1"))).toEqual([
		{ old: ["a.md"], files: 1, deleted: true },
		{ reports: ["r1.md"], files: 1 },
	]);
});

test("a mention is the composer's own @path form", () => {
	expect(mentionText(".thinkrail/context/a.md")).toBe("@.thinkrail/context/a.md ");
});

test("a row's change time reads as a localized date and time", () => {
	const label = artifactTimeLabel(currentTranslator(), Date.UTC(2026, 10, 13, 14, 32));
	expect(label).toStartWith("Changed ");
	expect(label).toContain("2026");
});

function smartOf(
	paths: readonly (readonly [string, "result" | "working", { at?: number; fresh?: boolean }?])[],
) {
	const snapshot: WorkspaceArtifactsSnapshot = {
		workspaceId: "w1",
		dir: ".thinkrail/context",
		artifacts: paths.map(([path, role, flags = {}]) => ({
			path: `.thinkrail/context/${path}`,
			state: "live",
			size: 1,
			changedAt: flags.at ?? 1,
			firstSeenAt: flags.fresh ? 9 : 1,
			role,
		})),
		outputs: null,
	};
	const rows = artifactRows(snapshot, {
		sessionId: null,
		highlightSince: 5,
		showIgnored: false,
		specs: [],
	});
	return smartGroups(rows.artifacts);
}

function shape(groups: readonly SmartGroup[]): unknown[] {
	return groups.map((group) => ({
		[group.name || "(top)"]: [
			...group.results.map((row) => row.name),
			...(group.working.length ? [`+${group.working.length} working`] : []),
			...shape(group.children),
		],
		...(group.fresh ? { fresh: true } : {}),
		results: group.resultCount,
		groups: group.groupCount,
	}));
}

test("smart groups gather results by folder, newest first, with their working files folded under them", () => {
	const view = smartOf([
		["TASK-x.md", "result", { at: 2 }],
		["notes.json", "working"],
		["gallery/analyzers/index.html", "result", { at: 5 }],
		["gallery/analyzers/images/a.png", "working"],
		["gallery/analyzers/tools/_raw/b.json", "working"],
		["mockups/features/01-trace/a.html", "result", { at: 7 }],
		["mockups/features/01-trace/b.html", "result", { at: 7, fresh: true }],
		["mockups/features/01-trace/gen.mjs", "working"],
		["mockups/features/02-time/a.html", "result", { at: 6 }],
		["mockups/features/_png/a.png", "working"],
		["research/topic/notes.md", "result", { at: 3 }],
		["scratch/loose.png", "working"],
	]);
	expect(shape(view.groups)).toEqual([
		{
			mockups: [
				{
					"features/01-trace": ["a.html", "b.html", "+1 working"],
					fresh: true,
					results: 2,
					groups: 0,
				},
				{ "features/02-time": ["a.html"], results: 1, groups: 0 },
			],
			fresh: true,
			results: 3,
			groups: 2,
		},
		{ "gallery/analyzers": ["index.html", "+2 working"], results: 1, groups: 0 },
		{ "research/topic": ["notes.md"], results: 1, groups: 0 },
		{ "(top)": ["TASK-x.md", "+1 working"], results: 1, groups: 0 },
	]);
	expect(view.results).toBe(6);
	expect(view.unattached.map((row) => row.artifact.path)).toEqual([
		".thinkrail/context/mockups/features/_png/a.png",
		".thinkrail/context/scratch/loose.png",
	]);
});

test("a folder that holds results itself becomes the parent of the result folders below it", () => {
	const view = smartOf([
		["mockups/features/PLAN.md", "result", { at: 1 }],
		["mockups/features/_kit/k.js", "working"],
		["mockups/features/01-trace/a.html", "result", { at: 4 }],
	]);
	expect(shape(view.groups)).toEqual([
		{
			"mockups/features": [
				"PLAN.md",
				"+1 working",
				{ "01-trace": ["a.html"], results: 1, groups: 0 },
			],
			results: 2,
			groups: 1,
		},
	]);
	expect(view.unattached).toEqual([]);
});
