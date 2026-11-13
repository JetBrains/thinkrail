import type {
	SpecGraphNode,
	WorkspaceArtifact,
	WorkspaceArtifactsSnapshot,
	WorkspaceIgnoredOutput,
} from "@thinkrail/contracts";

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
	const outputs =
		snapshot.outputs === null || !options.showIgnored
			? null
			: snapshot.outputs
					.filter((output) => mine(output.sessionId))
					.map((output) => ({ output, fresh: output.changedAt > options.highlightSince }));
	return { artifacts, outputs };
}

export function contextFolderOf(dir: string, path: string, kind: "file" | "dir"): string {
	if (kind === "dir") return path;
	const slash = path.lastIndexOf("/");
	return slash < 0 ? dir : path.slice(0, slash);
}

export function mentionText(path: string): string {
	return `@${path} `;
}
