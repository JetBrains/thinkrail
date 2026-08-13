import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evictSpecIndex, projectHasSpecs, saveTypeCard, specGraph } from "./specs";

let dataDir: string;
let worktree: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-spec-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
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
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
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

test("projectHasSpecs ignores ephemeral task-specs — only a durable spec signals 'set up'", () => {
	const root = mkdtempSync(join(tmpdir(), "trpi-proj-test-"));
	try {
		// A lone scratch task-spec (as brainstorming drops in .thinkrail/context/) must not count.
		writeFileSync(
			join(root, "TASK-x.md"),
			"---\nid: task-x\ntype: task-spec\ntitle: Scratch\n---\n\n## Body\n",
		);
		expect(projectHasSpecs(root)).toBe(false);

		// A durable spec flips it to true (revalidate-on-read picks up the new file on the same root).
		writeFileSync(
			join(root, "SPEC.md"),
			"---\nid: real\ntype: module-design\ntitle: Real\n---\n\n## Body\n",
		);
		expect(projectHasSpecs(root)).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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

test("the snapshot carries the type registry: built-ins plus a project card with a relative path", () => {
	writeSpec("SPEC.md", "id: root-spec\ntype: goal-and-requirements\ntitle: Root");
	mkdirSync(join(worktree, ".pi", "spec-types"), { recursive: true });
	writeFileSync(
		join(worktree, ".pi", "spec-types", "runbook.md"),
		"---\nname: runbook\ndescription: Ops steps.\nlifecycle: durable\n---\n",
	);

	const { types } = specGraph("ws1");
	const names = types.map((t) => t.name);
	expect(names).toContain("module-design");
	expect(names).toContain("charter");
	expect(names).toContain("decision");
	expect(types.find((t) => t.name === "task-spec")?.lifecycle).toBe("ephemeral");
	// Built-ins are embedded (no file) — the wire omits their path.
	expect(Object.hasOwn(types.find((t) => t.name === "module-design") ?? {}, "path")).toBe(false);

	const runbook = types.find((t) => t.name === "runbook");
	expect(runbook?.origin).toBe("project");
	expect(runbook?.path).toBe(".pi/spec-types/runbook.md"); // worktree-relative
});

test("projectHasSpecs respects a custom ephemeral type card", () => {
	const root = mkdtempSync(join(tmpdir(), "trpi-proj-eph-"));
	try {
		mkdirSync(join(root, ".pi", "spec-types"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "spec-types", "scratch.md"),
			"---\nname: scratch\ndescription: Ephemeral notes.\nlifecycle: ephemeral\n---\n",
		);
		writeFileSync(
			join(root, "NOTE.md"),
			"---\nid: n1\ntype: scratch\ntitle: Note\n---\n\n## Body\n",
		);
		// The only spec is of a custom ephemeral type — must not signal "set up".
		expect(projectHasSpecs(root)).toBe(false);

		// An unknown type counts as durable (the safe default).
		writeFileSync(
			join(root, "OTHER.md"),
			"---\nid: n2\ntype: mystery\ntitle: Other\n---\n\n## Body\n",
		);
		expect(projectHasSpecs(root)).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("saveTypeCard writes a project card, rejects bad slugs / non-cards / name mismatch", () => {
	const content = "---\nname: runbook\ndescription: Ops steps.\n---\n\nWhen to use.\n";
	expect(saveTypeCard("ws1", "runbook", content)).toEqual({ path: ".pi/spec-types/runbook.md" });
	expect(specGraph("ws1").types.find((t) => t.name === "runbook")?.origin).toBe("project");

	expect(() => saveTypeCard("ws1", "../evil", content)).toThrow("lowercase slug");
	expect(() => saveTypeCard("ws1", "Runbook", content)).toThrow("lowercase slug");
	expect(() => saveTypeCard("ws1", "runbook", "no frontmatter")).toThrow("not a valid type card");
	expect(() => saveTypeCard("ws1", "other", content)).toThrow("must match");
	expect(() => saveTypeCard("nope", "runbook", content)).toThrow("Unknown workspace");
});
