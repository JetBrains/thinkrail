import type {
	SpecGraphNode,
	WorkspaceArtifact,
	WorkspaceArtifactsSnapshot,
	WorkspaceIgnoredOutput,
} from "@thinkrail/contracts";
import { localeOf, type Translator } from "@thinkrail/locales/react";
import { ancestorPaths } from "../lib";
import { extendFolderChain, startFolderChain } from "./folderChains";

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
): ArtifactTreeNode[] {
	const live = liveFolders(artifacts);
	const root: FolderBuild = { dirs: new Map(), files: [] };
	for (const row of rows) {
		let build = root;
		for (const segment of row.folder ? row.folder.split("/") : []) {
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

	return materialize(root, dir);
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
