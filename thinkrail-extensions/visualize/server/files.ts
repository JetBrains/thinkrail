import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileChecker } from "@thinkrail/pi-visualize";

export const MOCKUP_DIR = ".thinkrail/context/mockups/";

function inside(root: string, candidate: string): string | null {
	const rel = relative(root, candidate);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
	return rel;
}

export const workspaceFileChecker: FileChecker = (path, cwd) => {
	const absolute = resolve(cwd, path);
	const rel = isAbsolute(path) ? null : inside(resolve(cwd), absolute);
	if (rel === null)
		throw new Error("the path must be relative to the workspace and stay inside it");
	if (rel.split(sep).includes(".git")) throw new Error("the .git directory is not shown");
	const stat = statSync(absolute, { throwIfNoEntry: false });
	if (!stat) throw new Error("no such file");
	if (!stat.isFile()) throw new Error("not a regular file");
	if (inside(realpathSync(cwd), realpathSync(absolute)) === null) {
		throw new Error("the path must stay inside the workspace (a link points outside it)");
	}
};
