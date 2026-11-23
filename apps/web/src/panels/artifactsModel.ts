import type {
	SpecGraphNode,
	WorkspaceArtifact,
	WorkspaceArtifactsSnapshot,
	WorkspaceIgnoredOutput,
} from "@thinkrail/contracts";
import { localeOf, type Translator } from "@thinkrail/locales/react";
import { outputFileLabel } from "@thinkrail/resource-renderers";
import { extendFolderChain, startFolderChain } from "@thinkrail/ui/folder-chains";
import { ancestorPaths } from "../lib";

export interface ArtifactRow {
	artifact: WorkspaceArtifact;
	name: string;
	folder: string;
	taskSpecStatus: string | null;
	fresh: boolean;
}

export interface OutputRow {
	output: WorkspaceIgnoredOutput;
	fresh: boolean;
}

export interface ArtifactRows {
	artifacts: ArtifactRow[];
	outputs: OutputRow[] | null;
	otherChats: number;
}

export interface ArtifactRowOptions {
	sessionId: string | null;
	highlightSince: number;
	showIgnored: boolean;
	specs: readonly SpecGraphNode[] | undefined;
}

function splitPath(dir: string, path: string): { name: string; folder: string } {
	const inside = path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;
	const slash = inside.lastIndexOf("/");
	return slash < 0
		? { name: inside, folder: "" }
		: { name: inside.slice(slash + 1), folder: inside.slice(0, slash) };
}

export function artifactRows(
	snapshot: WorkspaceArtifactsSnapshot,
	options: ArtifactRowOptions,
): ArtifactRows {
	const taskSpecs = new Map(
		(options.specs ?? [])
			.filter((node) => node.type === "task-spec")
			.map((node) => [node.path, node.status ?? null]),
	);
	const mine = (sessionId: string | undefined) =>
		options.sessionId === null || sessionId === options.sessionId;
	const artifacts = snapshot.artifacts
		.filter((artifact) => mine(artifact.sessionId))
		.map((artifact) => ({
			artifact,
			...splitPath(snapshot.dir, artifact.path),
			taskSpecStatus: taskSpecs.has(artifact.path) ? (taskSpecs.get(artifact.path) ?? "") : null,
			fresh: artifact.firstSeenAt > options.highlightSince,
		}));
	const shownOutputs = snapshot.outputs === null || !options.showIgnored ? null : snapshot.outputs;
	const outputs =
		shownOutputs
			?.filter((output) => mine(output.sessionId))
			.map((output) => ({ output, fresh: output.changedAt > options.highlightSince })) ?? null;
	const otherChats =
		snapshot.artifacts.length -
		artifacts.length +
		(shownOutputs?.length ?? 0) -
		(outputs?.length ?? 0);
	return { artifacts, outputs, otherChats };
}

export interface ArtifactTreeFile {
	kind: "file";
	name: string;
	path: string;
	row: ArtifactRow;
}

export interface ArtifactTreeFolder {
	kind: "dir";
	name: string;
	path: string;
	paths: readonly string[];
	children: ArtifactTreeNode[];
	files: number;
	fresh: boolean;
	deleted: boolean;
}

export type ArtifactTreeNode = ArtifactTreeFolder | ArtifactTreeFile;

interface FolderBuild {
	dirs: Map<string, FolderBuild>;
	files: ArtifactTreeFile[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function liveFolders(artifacts: readonly WorkspaceArtifact[]): Set<string> {
	const folders = new Set<string>();
	for (const artifact of artifacts) {
		if (artifact.state !== "deleted")
			for (const folder of ancestorPaths(artifact.path)) folders.add(folder);
	}
	return folders;
}

export function artifactTree(
	dir: string,
	rows: readonly ArtifactRow[],
	artifacts: readonly WorkspaceArtifact[],
	base = "",
): ArtifactTreeNode[] {
	const live = liveFolders(artifacts);
	const root: FolderBuild = { dirs: new Map(), files: [] };
	for (const row of rows) {
		let build = root;
		const folder = base ? row.folder.slice(base.length + 1) : row.folder;
		for (const segment of folder ? folder.split("/") : []) {
			let next = build.dirs.get(segment);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				build.dirs.set(segment, next);
			}
			build = next;
		}
		build.files.push({ kind: "file", name: row.name, path: row.artifact.path, row });
	}

	const materialize = (build: FolderBuild, prefix: string): ArtifactTreeNode[] => {
		const folders = [...build.dirs.entries()].map(([name, child]): ArtifactTreeFolder => {
			let chain = startFolderChain({ kind: "dir", name, path: `${prefix}/${name}` });
			let paths: readonly string[] = chain.paths;
			let children = materialize(child, chain.path);
			for (;;) {
				const extension = extendFolderChain(chain, children);
				if (!extension) break;
				chain = extension.chain;
				paths = [...paths, ...extension.directory.paths];
				children = extension.directory.children;
			}
			let files = 0;
			let fresh = false;
			for (const node of children) {
				if (node.kind === "dir") {
					files += node.files;
					fresh ||= node.fresh;
				} else {
					files += 1;
					fresh ||= node.row.fresh;
				}
			}
			return {
				kind: "dir",
				name: chain.label,
				path: chain.path,
				paths,
				children,
				files,
				fresh,
				deleted: !live.has(chain.path),
			};
		});
		return [...folders.sort(byName), ...build.files.sort(byName)];
	};

	return materialize(root, base ? `${dir}/${base}` : dir);
}

export interface SmartGroup {
	folder: string;
	name: string;
	results: ArtifactRow[];
	working: ArtifactRow[];
	children: SmartGroup[];
	newest: number;
	fresh: boolean;
	resultCount: number;
	groupCount: number;
}

export interface SmartView {
	groups: SmartGroup[];
	unattached: ArtifactRow[];
	results: number;
}

const isResult = (row: ArtifactRow) => row.artifact.role === "result";

const parentFolder = (folder: string) =>
	folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";

function group(folder: string): SmartGroup {
	return {
		folder,
		name: folder,
		results: [],
		working: [],
		children: [],
		newest: 0,
		fresh: false,
		resultCount: 0,
		groupCount: 0,
	};
}

function homeOf(groups: ReadonlyMap<string, SmartGroup>, folder: string): SmartGroup | undefined {
	for (let at = folder; ; at = parentFolder(at)) {
		const home = groups.get(at);
		if (home && (at !== "" || folder === "")) return home;
		if (at === "") return undefined;
	}
}

export function smartGroups(rows: readonly ArtifactRow[]): SmartView {
	const groups = new Map<string, SmartGroup>();
	for (const row of rows.filter(isResult)) {
		const home = groups.get(row.folder) ?? group(row.folder);
		groups.set(row.folder, home);
		home.results.push(row);
	}
	const unattached: ArtifactRow[] = [];
	for (const row of rows) {
		if (isResult(row)) continue;
		const home = homeOf(groups, row.folder);
		if (home) home.working.push(row);
		else unattached.push(row);
	}

	const roots: SmartGroup[] = [];
	for (const node of groups.values()) {
		const parent = node.folder ? homeOf(groups, parentFolder(node.folder)) : undefined;
		if (parent && parent.folder !== "") parent.children.push(node);
		else roots.push(node);
	}
	const byTop = new Map<string, SmartGroup[]>();
	for (const node of roots) {
		if (!node.folder.includes("/")) continue;
		const top = node.folder.slice(0, node.folder.indexOf("/"));
		byTop.set(top, [...(byTop.get(top) ?? []), node]);
	}
	for (const [top, nodes] of byTop) {
		if (nodes.length < 2) continue;
		const shared = group(top);
		shared.children = nodes;
		roots.splice(0, roots.length, ...roots.filter((node) => !nodes.includes(node)), shared);
	}

	const finish = (node: SmartGroup, parent: string): SmartGroup => {
		node.name =
			parent && node.folder.startsWith(`${parent}/`)
				? node.folder.slice(parent.length + 1)
				: node.folder;
		node.results.sort((a, b) => a.name.localeCompare(b.name));
		node.children = node.children.map((child) => finish(child, node.folder));
		node.children.sort((a, b) => b.newest - a.newest);
		node.newest = Math.max(
			0,
			...node.results.map((row) => row.artifact.changedAt),
			...node.children.map((child) => child.newest),
		);
		node.fresh =
			node.results.some((row) => row.fresh) || node.children.some((child) => child.fresh);
		node.resultCount =
			node.results.length + node.children.reduce((sum, child) => sum + child.resultCount, 0);
		node.groupCount = node.children.reduce((sum, child) => sum + 1 + child.groupCount, 0);
		return node;
	};
	const finished = roots.map((node) => finish(node, "")).sort((a, b) => b.newest - a.newest);
	return {
		groups: finished,
		unattached,
		results: finished.reduce((sum, node) => sum + node.resultCount, 0),
	};
}

export interface OutputEntry {
	row: ArtifactRow;
	name: string;
	type: string | null;
	folder: string | null;
}

export function outputEntries(rows: readonly ArtifactRow[]): OutputEntry[] {
	const labeled = rows
		.filter((row) => row.artifact.published && row.artifact.state === "live")
		.map((row) => ({ row, ...outputFileLabel(row.artifact.path) }));
	const key = (entry: { name: string; type: string | null }) => `${entry.type}\u0000${entry.name}`;
	const counts = new Map<string, number>();
	for (const entry of labeled) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
	return labeled.map((entry) => ({
		...entry,
		folder: (counts.get(key(entry)) ?? 0) > 1 && entry.row.folder ? entry.row.folder : null,
	}));
}

export function artifactTimeLabel(t: Translator, changedAt: number): string {
	return t("panels.artifacts.changedAt", {
		time: new Date(changedAt).toLocaleString(localeOf(t), {
			dateStyle: "medium",
			timeStyle: "short",
		}),
	});
}

export function mentionText(path: string): string {
	return `@${path} `;
}
