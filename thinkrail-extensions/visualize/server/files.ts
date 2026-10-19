import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { FileChecker } from "@thinkrail/pi-visualize";

export const MOCKUP_DIR = ".thinkrail/context/mockups/";

export const workspaceFileChecker: FileChecker = (path, cwd) => {
	const absolute = resolve(cwd, path);
	const inside = relative(cwd, absolute);
	if (isAbsolute(path) || inside === "" || inside.startsWith("..")) {
		throw new Error("the path must be relative to the workspace and stay inside it");
	}
	const stat = statSync(absolute, { throwIfNoEntry: false });
	if (!stat) throw new Error("no such file");
	if (!stat.isFile()) throw new Error("not a regular file");
};
