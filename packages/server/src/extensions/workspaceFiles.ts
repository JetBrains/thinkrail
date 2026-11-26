import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { WORKSPACE_MOCKUP_DIR } from "@thinkrail/contracts";
import type { ArtifactCheck, WorkspaceFiles } from "@thinkrail/extension-api/server";
import { seedArtifactsDir } from "@thinkrail/shared/artifactsDir";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";

export const MOCKUP_DIR = `${WORKSPACE_MOCKUP_DIR}/`;

function inside(root: string, candidate: string): string | null {
	const rel = relative(root, candidate);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel;
}

export async function checkWorkspaceFile(path: string, cwd: string): Promise<void> {
	const absolute = resolve(cwd, path);
	const rel = isAbsolute(path) ? null : inside(resolve(cwd), absolute);
	if (rel === null)
		throw new Error("the path must be relative to the workspace and stay inside it");
	if (rel.split(sep).includes(".git")) throw new Error("the .git directory is not shown");
	const info = await stat(absolute).catch(() => undefined);
	if (!info) throw new Error("no such file");
	if (!info.isFile()) throw new Error("not a regular file");
	if (inside(await realpath(cwd), await realpath(absolute)) === null) {
		throw new Error("the path must stay inside the workspace (a link points outside it)");
	}
}

type ArtifactFilesCheck = (paths: readonly string[], cwd: string) => ArtifactCheck[];

let artifactFilesCheck: ArtifactFilesCheck | null = null;

export function setArtifactFileCheck(check: ArtifactFilesCheck | null): void {
	artifactFilesCheck = check;
}

export const workspaceFiles: WorkspaceFiles = {
	check: checkWorkspaceFile,
	checkArtifacts: async (paths, cwd) => {
		if (!artifactFilesCheck) throw new Error("this host keeps no artifact index");
		return artifactFilesCheck(paths, cwd);
	},
	ensureArtifactsDir: async (cwd) => {
		seedArtifactsDir(resolve(cwd));
	},
	scratchDir: MOCKUP_DIR,
	artifactsDir: `${WORKSPACE_CONTEXT_DIR}/`,
};
