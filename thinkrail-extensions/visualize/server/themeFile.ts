/// <reference path="./themeCss.d.ts" />
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import THEME_CSS from "./generated/thinkrail-theme.css" with { type: "text" };

export const THEME_FILE_NAME = "thinkrail-theme.css";

export { THEME_CSS };

async function insideWorkspace(cwd: string, dir: string): Promise<boolean> {
	const rel = relative(await realpath(cwd), await realpath(dir));
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function realDirectory(path: string): Promise<boolean | null> {
	const entry = await lstat(path).catch(() => null);
	if (!entry) return null;
	if (!entry.isDirectory()) throw new Error(`not a real directory: ${path}`);
	return true;
}

/** Writes only inside an existing real `.thinkrail/context`, so it never creates an un-ignored tree. */
export async function writeThemeFile({
	cwd,
	scratchDir,
	css = THEME_CSS,
}: {
	cwd: string;
	scratchDir: string;
	css?: string;
}): Promise<"written" | "unchanged" | "skipped"> {
	const parts = scratchDir.split("/").filter((part) => part !== "");
	const leaf = parts.pop();
	if (!leaf) throw new Error(`not a scratch directory: ${scratchDir}`);
	let dir = cwd;
	for (const part of parts) {
		dir = join(dir, part);
		if (!(await realDirectory(dir))) return "skipped";
	}
	dir = join(dir, leaf);
	if (!(await realDirectory(dir))) await mkdir(dir);
	if (!(await insideWorkspace(cwd, dir))) {
		throw new Error(`the mockup directory resolves outside the workspace: ${dir}`);
	}
	const path = join(dir, THEME_FILE_NAME);
	const entry = await lstat(path).catch(() => null);
	if (entry && !entry.isFile()) throw new Error(`not a regular file: ${path}`);
	if (entry && (await readFile(path, "utf8")) === css) return "unchanged";
	await writeFile(path, css);
	return "written";
}
