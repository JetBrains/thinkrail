import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evictSpecIndex, specGraph } from "./specs";

let dataDir: string;
let worktree: string;
const savedDataDir = process.env.THINKRAIL_PI_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-spec-test-"));
	process.env.THINKRAIL_PI_DATA_DIR = dataDir;
	worktree = join(dataDir, "worktree");
	mkdirSync(worktree);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws1",
				projectId: "p1",
				name: "ws",
				branch: "b",
				worktreePath: worktree,
				baseBranch: "main",
			},
		]),
	);
	// The index cache is module-level and keyed by workspace id — evict so each test sees its own root.
	evictSpecIndex("ws1");
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_PI_DATA_DIR;
	else process.env.THINKRAIL_PI_DATA_DIR = savedDataDir;
});

function writeSpec(rel: string, frontmatter: string): void {
	mkdirSync(join(worktree, rel, ".."), { recursive: true });
	writeFileSync(join(worktree, rel), `---\n${frontmatter}\n---\n\n## Body\n\nProse.\n`);
}

test("maps spec files to wire DTOs (title falls back to id; absent status/parent are omitted)", () => {
	writeSpec("SPEC.md", "id: root-spec\ntype: goal-and-requirements\ntitle: Root\ntags: [v1]");
	// No title (falls back to id), with status + parent + a depends-on list.
	writeSpec(
		"module-a/SPEC.md",
		"id: mod-a\ntype: module-design\nstatus: active\nparent: root-spec\ndepends-on: [root-spec]",
	);
	// A plain markdown file is not a spec and never reaches the wire.
	writeFileSync(join(worktree, "README.md"), "# not a spec\n");

	const { nodes } = specGraph("ws1");
	expect(nodes.map((n) => n.id).sort()).toEqual(["mod-a", "root-spec"]);

	const root = nodes.find((n) => n.id === "root-spec");
	expect(root?.title).toBe("Root");
	expect(root?.path).toBe("SPEC.md");
	expect(root?.tags).toEqual(["v1"]);
	// exactOptionalPropertyTypes: absent scalars are omitted keys, not `undefined` values.
	expect(Object.hasOwn(root ?? {}, "status")).toBe(false);
	expect(Object.hasOwn(root ?? {}, "parent")).toBe(false);

	const modA = nodes.find((n) => n.id === "mod-a");
	expect(modA?.title).toBe("mod-a"); // title falls back to id
	expect(modA?.status).toBe("active");
	expect(modA?.parent).toBe("root-spec");
	expect(modA?.dependsOn).toEqual(["root-spec"]);
	expect(modA?.path).toBe("module-a/SPEC.md");
});

test("throws for an unknown workspace", () => {
	expect(() => specGraph("nope")).toThrow("Unknown workspace: nope");
});

test("revalidates on read: a spec added after the first fetch appears on the next", () => {
	writeSpec("SPEC.md", "id: root-spec\ntype: goal-and-requirements\ntitle: Root");
	expect(specGraph("ws1").nodes).toHaveLength(1);

	writeSpec("module-b/SPEC.md", "id: mod-b\ntype: module-design\ntitle: Mod B\nparent: root-spec");
	expect(
		specGraph("ws1")
			.nodes.map((n) => n.id)
			.sort(),
	).toEqual(["mod-b", "root-spec"]);
});

test("evictSpecIndex drops the cached index; a later read rebuilds cleanly", () => {
	writeSpec("SPEC.md", "id: root-spec\ntype: goal-and-requirements\ntitle: Root");
	expect(specGraph("ws1").nodes).toHaveLength(1);

	evictSpecIndex("ws1");
	expect(specGraph("ws1").nodes.map((n) => n.id)).toEqual(["root-spec"]);
});
