import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceFiles } from "@thinkrail/extension-api/server";

export const MOCKUP_DIR = ".thinkrail/context/mockups/";

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

export const workspaceFiles: WorkspaceFiles = { check: checkWorkspaceFile, scratchDir: MOCKUP_DIR };
