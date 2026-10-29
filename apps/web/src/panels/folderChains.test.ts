import { expect, test } from "bun:test";
import { changeTouchesDirectory, type FolderChainNode, resolveFolderChain } from "./folderChains";

function dir(name: string, path = name): FolderChainNode {
	return { kind: "dir", name, path };
}

function file(name: string, path = name): FolderChainNode {
	return { kind: "file", name, path };
}

test("resolveFolderChain joins a run of single-directory children and returns the deepest listing", async () => {
	const reads: string[] = [];
	const listings = new Map<string, FolderChainNode[]>([
		["apps", [dir("web", "apps/web")]],
		["apps/web", [dir("src", "apps/web/src")]],
		["apps/web/src", [file("index.ts", "apps/web/src/index.ts")]],
	]);

	const resolved = await resolveFolderChain(dir("apps"), async (path) => {
		reads.push(path);
		return listings.get(path) ?? [];
	});

	expect(resolved).toEqual({
		label: "apps/web/src",
		path: "apps/web/src",
		paths: ["apps", "apps/web", "apps/web/src"],
		deepest: dir("src", "apps/web/src"),
		children: [file("index.ts", "apps/web/src/index.ts")],
	});
	expect(reads).toEqual(["apps", "apps/web", "apps/web/src"]);
});

test("resolveFolderChain stops at empty, file-only, and branching directories", async () => {
	const empty = await resolveFolderChain(dir("empty"), async () => []);
	expect(empty).toEqual({
		label: "empty",
		path: "empty",
		paths: ["empty"],
		deepest: dir("empty"),
		children: [],
	});

	const fileOnly = await resolveFolderChain(dir("docs"), async () => [
		file("guide.md", "docs/guide.md"),
	]);
	expect(fileOnly.label).toBe("docs");

	const branched = [dir("client", "src/client"), dir("server", "src/server")];
	const branch = await resolveFolderChain(dir("src"), async () => branched);
	expect(branch).toEqual({
		label: "src",
		path: "src",
		paths: ["src"],
		deepest: dir("src"),
		children: branched,
	});
});

test("a directory row is touched by changes at or under it and by a .gitignore above it", () => {
	const touches = (changedPath: string) => changeTouchesDirectory("src/app", changedPath);
	expect(touches("src/app")).toBe(true);
	expect(touches("src/app/main.ts")).toBe(true);
	expect(touches("src/app/deep/nested.ts")).toBe(true);
	expect(touches(".gitignore")).toBe(true);
	expect(touches("src/.gitignore")).toBe(true);
	expect(touches("src/app/.gitignore")).toBe(true);
	expect(touches("src/application/main.ts")).toBe(false);
	expect(touches("src/other.ts")).toBe(false);
	expect(touches("README.md")).toBe(false);
	expect(touches("lib/.gitignore")).toBe(false);
	expect(touches("src/app2/.gitignore")).toBe(false);
});

test("a directory under a path the watcher never reports is touched by every change", () => {
	expect(changeTouchesDirectory("node_modules/pkg", "bun.lock")).toBe(true);
	expect(changeTouchesDirectory("node_modules", "src/main.ts")).toBe(true);
	expect(changeTouchesDirectory("lib/node_modules/x", "README.md")).toBe(true);
	expect(changeTouchesDirectory("node_modules_cache", "README.md")).toBe(false);
});
