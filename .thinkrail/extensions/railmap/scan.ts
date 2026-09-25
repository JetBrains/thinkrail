import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { isSpec, parseFile } from "pi-spec-graph/core";
import ts from "typescript";
import type { ImportRef, ScanState } from "./analyze";
import { isRecord } from "./model";
import { isCodeFile } from "./resolve";

const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"test-results",
	"playwright-report",
	"blob-report",
	"artifacts",
]);
const MAX_SOURCE_BYTES = 2_000_000;
const BATCH = 48;
const MAX_CODE_FILES = 20_000;
const MAX_WALK_FILES = 200_000;
const EXTENSIONS_DIR = ".thinkrail/extensions";

export const toRel = (root: string, path: string) => relative(root, path).split(sep).join("/");

const isDirAllowed = (rel: string) => {
	const name = posix.basename(rel);
	if (SKIP_DIRS.has(name)) return false;
	if (name.startsWith(".")) return rel === ".github" || rel === ".thinkrail";
	if (rel.startsWith(".thinkrail/"))
		return rel === EXTENSIONS_DIR || rel.startsWith(`${EXTENSIONS_DIR}/`);
	return true;
};

export const isIgnored = (rel: string) => {
	const parts = rel.split("/");
	for (let index = 1; index < parts.length; index++)
		if (!isDirAllowed(parts.slice(0, index).join("/"))) return true;
	return false;
};

const walk = async (root: string, start = "") => {
	const found: string[] = [];
	const visit = async (rel: string) => {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(join(root, rel), { withFileTypes: true });
		} catch {
			return;
		}
		const dirs: string[] = [];
		for (const entry of entries) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (isDirAllowed(child)) dirs.push(child);
			} else if (entry.isFile()) found.push(child);
		}
		if (found.length > MAX_WALK_FILES)
			throw new Error(`more than ${MAX_WALK_FILES} files; railmap stops here`);
		await Promise.all(dirs.map(visit));
	};
	await visit(start);
	return found;
};

const lineStarts = (text: string) => {
	const starts = [0];
	for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1))
		starts.push(index + 1);
	return starts;
};

const lineAt = (starts: readonly number[], pos: number) => {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if ((starts[mid] ?? 0) <= pos) low = mid;
		else high = mid - 1;
	}
	return low + 1;
};

const scanImports = (text: string): ImportRef[] => {
	const { importedFiles } = ts.preProcessFile(text, true, true);
	if (importedFiles.length === 0) return [];
	const starts = lineStarts(text);
	return importedFiles.map((ref) => ({ specifier: ref.fileName, line: lineAt(starts, ref.pos) }));
};

const packageInfo = (text: string) => {
	const parsed: unknown = JSON.parse(text);
	if (!isRecord(parsed) || typeof parsed.name !== "string") return undefined;
	return {
		name: parsed.name,
		exports: parsed.exports,
		...(typeof parsed.main === "string" ? { main: parsed.main } : {}),
	};
};

const isSpecFile = (rel: string) => posix.basename(rel) === "SPEC.md";
const isPackageFile = (rel: string) => posix.basename(rel) === "package.json";

const needsRead = (rel: string) => isCodeFile(rel) || isSpecFile(rel) || isPackageFile(rel);

const forget = (scan: ScanState, rel: string) => {
	scan.sources.delete(rel);
	scan.specs.delete(rel);
	if (isPackageFile(rel)) scan.packages.delete(posix.dirname(rel));
};

const readInto = async (scan: ScanState, root: string, rel: string) => {
	forget(scan, rel);
	let text: string;
	try {
		const info = await stat(join(root, rel));
		if (!info.isFile()) return;
		if (isCodeFile(rel) && info.size > MAX_SOURCE_BYTES) {
			scan.sources.set(rel, []);
			return;
		}
		text = await readFile(join(root, rel), "utf8");
	} catch {
		return;
	}
	try {
		if (isCodeFile(rel)) scan.sources.set(rel, scanImports(text));
		else if (isSpecFile(rel)) {
			const { frontmatter } = parseFile(text);
			if (isSpec(frontmatter)) scan.specs.set(rel, frontmatter);
		} else if (isPackageFile(rel)) {
			const info = packageInfo(text);
			if (info) scan.packages.set(posix.dirname(rel), info);
		}
	} catch {
		if (isCodeFile(rel)) scan.sources.set(rel, []);
	}
};

const yieldToHost = () => new Promise<void>((done) => setImmediate(done));

const readAll = async (
	scan: ScanState,
	root: string,
	paths: readonly string[],
	onProgress?: (done: number, total: number) => void,
) => {
	const wanted = paths.filter(needsRead);
	for (let index = 0; index < wanted.length; index += BATCH) {
		await Promise.all(wanted.slice(index, index + BATCH).map((rel) => readInto(scan, root, rel)));
		onProgress?.(Math.min(index + BATCH, wanted.length), wanted.length);
		await yieldToHost();
	}
};

export const coldScan = async (
	scan: ScanState,
	root: string,
	onProgress?: (done: number, total: number) => void,
) => {
	const paths = await walk(root);
	const code = paths.filter(isCodeFile).length;
	if (code > MAX_CODE_FILES)
		throw new Error(`${code} code files; railmap stops above ${MAX_CODE_FILES}`);
	for (const path of paths) scan.files.add(path);
	await readAll(scan, root, paths, onProgress);
};

export const applyChanges = async (scan: ScanState, root: string, changed: readonly string[]) => {
	for (const rel of changed) {
		if (isIgnored(rel)) continue;
		let kind: "file" | "dir" | "gone" = "gone";
		try {
			const info = await stat(join(root, rel));
			kind = info.isDirectory() ? "dir" : info.isFile() ? "file" : "gone";
		} catch {}
		if (kind === "file") {
			scan.files.add(rel);
			await readInto(scan, root, rel);
			continue;
		}
		const prefix = `${rel}/`;
		for (const path of [...scan.files])
			if (path === rel || path.startsWith(prefix)) {
				scan.files.delete(path);
				forget(scan, path);
			}
		if (kind === "dir" && isDirAllowed(rel)) {
			const paths = await walk(root, rel);
			for (const path of paths) scan.files.add(path);
			await readAll(scan, root, paths);
		}
	}
};
