import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readOpenspecTree } from "./openspecTree";

const roots: string[] = [];

function worktree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "openspec-tree-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readOpenspecTree", () => {
	test("reads only openspec/'s markdown and YAML, sorted, and null without the folder", async () => {
		const root = worktree({
			"openspec/specs/auth/spec.md": "# auth\n",
			"openspec/changes/a/.openspec.yaml": "schema: spec-driven\n",
			"openspec/changes/a/notes.txt": "skipped\n",
			"openspec/changes/archive/.gitkeep": "",
			"openspec/schemas/x/schema.yml": "name: x\n",
			"README.md": "# outside\n",
		});
		expect((await readOpenspecTree(root))?.files.map((file) => file.path)).toEqual([
			"openspec/changes/a/.openspec.yaml",
			"openspec/schemas/x/schema.yml",
			"openspec/specs/auth/spec.md",
		]);
		expect(await readOpenspecTree(worktree({ "README.md": "x" }))).toBeNull();
	});

	test("never follows a symlink, the openspec/ folder itself included", async () => {
		const outside = worktree({ "secret.md": "secret\n", "dir/inner.md": "inner\n" });
		const root = worktree({ "openspec/config.yaml": "schema: spec-driven\n" });
		symlinkSync(join(outside, "secret.md"), join(root, "openspec", "linked.md"));
		symlinkSync(join(outside, "dir"), join(root, "openspec", "linked-dir"));
		expect((await readOpenspecTree(root))?.files.map((file) => file.path)).toEqual([
			"openspec/config.yaml",
		]);
		const linked = worktree({});
		symlinkSync(join(outside, "dir"), join(linked, "openspec"));
		expect(await readOpenspecTree(linked)).toBeNull();
	});

	test("stops at the size or file cap and says it was truncated", async () => {
		const root = worktree({
			"openspec/a.md": "a".repeat(10),
			"openspec/b.md": "b".repeat(10),
			"openspec/c.md": "c",
		});
		expect(await readOpenspecTree(root, { maxBytes: 15, maxFiles: 10 })).toEqual({
			files: [{ path: "openspec/a.md", text: "a".repeat(10) }],
			truncated: true,
		});
		expect((await readOpenspecTree(root, { maxBytes: 1_000, maxFiles: 2 }))?.truncated).toBe(true);
	});
});
