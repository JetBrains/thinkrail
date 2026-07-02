import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { LINK_KINDS, SLICE_DIRECTIONS, SPEC_STATUSES, SPEC_TYPES } from "../core/index.ts";
import { registerSpecTools } from "./index.ts";

// Capture the registered tool defs via a minimal fake ExtensionAPI, then drive their `execute`
// against a real temp cwd — the tools layer's integration surface (param plumbing, fs writes, and the
// result shape). `execute` is a method, so heterogeneous defs collect in one typed map.
const tools = new Map<string, ToolDefinition>();
registerSpecTools({
	registerTool(tool: ToolDefinition) {
		tools.set(tool.name, tool);
	},
} as unknown as ExtensionAPI);

function run(
	name: string,
	params: Record<string, unknown>,
	cwd: string,
): Promise<AgentToolResult<unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`missing tool: ${name}`);
	return tool.execute("call-1", params, undefined, undefined, {
		cwd,
	} as unknown as ExtensionContext);
}

function isError(result: AgentToolResult<unknown>): boolean {
	return typeof result.details === "object" && result.details !== null && "error" in result.details;
}

/** The `enum` values a tool's param schema advertises (StringEnum params), or `[]` when none. */
function paramEnum(toolName: string, prop: string): readonly string[] {
	const schema = tools.get(toolName)?.parameters as {
		properties?: Record<string, { enum?: string[] }>;
	};
	return schema.properties?.[prop]?.enum ?? [];
}

// Pin each finite-vocabulary param to its core tuple: guards against a literal list being re-hardcoded
// in the tools layer instead of derived from core (the single source of truth).
test("finite-vocabulary param schemas derive their enum from the core tuples", () => {
	expect(paramEnum("spec_create", "type")).toEqual([...SPEC_TYPES]);
	expect(paramEnum("spec_create", "status")).toEqual([...SPEC_STATUSES]);
	expect(paramEnum("spec_graph", "direction")).toEqual([...SLICE_DIRECTIONS]);
	expect(paramEnum("spec_graph", "edge")).toEqual([...LINK_KINDS]);
});

/** The human-readable text of a tool result's first content block. */
function text(result: AgentToolResult<unknown>): string {
	const block = result.content[0] as { text?: string } | undefined;
	return block?.text ?? "";
}

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "spec-tools-"));
	try {
		await fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// A small, realistic spec-graph, built through the tools (each write is picked up by the next read):
//   product (g&r) ← arch ← { mod-a, mod-b };  mod-a ← sub-a
//   mod-a --depends-on--> mod-b;  mod-a --references--> arch;  sub-a --implements--> mod-a
async function seedGraph(root: string): Promise<void> {
	await run(
		"spec_create",
		{ path: "goal.md", id: "product", type: "goal-and-requirements", title: "Product" },
		root,
	);
	await run(
		"spec_create",
		{
			path: "architecture.md",
			id: "arch",
			type: "architecture-design",
			title: "Architecture",
			parent: "product",
		},
		root,
	);
	await run(
		"spec_create",
		{ path: "b/SPEC.md", id: "mod-b", type: "module-design", title: "Module B", parent: "arch" },
		root,
	);
	await run(
		"spec_create",
		{
			path: "a/SPEC.md",
			id: "mod-a",
			type: "module-design",
			title: "Module A",
			parent: "arch",
			dependsOn: ["mod-b"],
			references: ["arch"],
			tags: ["core"],
		},
		root,
	);
	await run(
		"spec_create",
		{
			path: "a/sub/SPEC.md",
			id: "sub-a",
			type: "submodule-design",
			title: "Sub A",
			parent: "mod-a",
			implements: ["mod-a"],
		},
		root,
	);
}

test("registers exactly the seven spec tools", () => {
	expect([...tools.keys()].sort()).toEqual([
		"spec_create",
		"spec_delete",
		"spec_get",
		"spec_graph",
		"spec_grep",
		"spec_update",
		"spec_validate",
	]);
});

test("spec_create scaffolds frontmatter + body; spec_get resolves it (no body)", async () => {
	await withRoot(async (root) => {
		const created = await run(
			"spec_create",
			{ path: "pkg/SPEC.md", id: "pkg", type: "module-design", title: "Pkg" },
			root,
		);
		expect(isError(created)).toBe(false);

		const file = readFileSync(join(root, "pkg/SPEC.md"), "utf8");
		expect(file).toContain("id: pkg");
		expect(file).toContain("type: module-design");
		expect(file).toContain("## Responsibility");
		expect(file).toContain("## Boundary");

		const got = await run("spec_get", { id: "pkg" }, root);
		expect(isError(got)).toBe(false);
		const d = got.details as { id: string; path: string; type: string };
		expect(d.id).toBe("pkg");
		expect(d.path).toBe("pkg/SPEC.md");
		expect(d.type).toBe("module-design");
	});
});

test("spec_create rejects a duplicate id and an existing path", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "pkg/SPEC.md", id: "pkg", type: "module-design", title: "P" },
			root,
		);
		expect(
			isError(
				await run(
					"spec_create",
					{ path: "other.md", id: "pkg", type: "task-spec", title: "Dup" },
					root,
				),
			),
		).toBe(true);
		expect(
			isError(
				await run(
					"spec_create",
					{ path: "pkg/SPEC.md", id: "x", type: "task-spec", title: "Exists" },
					root,
				),
			),
		).toBe(true);
	});
});

test("spec_graph returns a bounded subtree; spec_grep searches within specs + metadata filter", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "pkg/SPEC.md", id: "pkg", type: "module-design", title: "Pkg" },
			root,
		);
		await run(
			"spec_create",
			{ path: "pkg/sub/SPEC.md", id: "sub", type: "submodule-design", title: "Sub", parent: "pkg" },
			root,
		);

		const slice = await run("spec_graph", { root: "pkg", direction: "subtree", depth: 1 }, root);
		const s = slice.details as { nodes: { id: string }[] };
		expect(s.nodes.map((n) => n.id).sort()).toEqual(["pkg", "sub"]);

		const grep = await run("spec_grep", { pattern: "Responsibility" }, root);
		const g = grep.details as { matches: { path: string }[] };
		expect(g.matches.length).toBeGreaterThan(0);

		const filtered = await run(
			"spec_grep",
			{ pattern: "Responsibility", type: "submodule-design" },
			root,
		);
		const f = filtered.details as { matches: { path: string }[] };
		expect(f.matches.length).toBeGreaterThan(0);
		expect(f.matches.every((m) => m.path.startsWith("pkg/sub"))).toBe(true);
	});
});

test("spec_update edits frontmatter only (body preserved); refuses protected + unknown id", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M" },
			root,
		);

		const upd = await run(
			"spec_update",
			{ id: "m", set: { title: "M v2" }, addList: { references: ["pkg"] } },
			root,
		);
		expect(isError(upd)).toBe(false);

		const file = readFileSync(join(root, "m/SPEC.md"), "utf8");
		expect(file).toContain("title: M v2");
		expect(file).toContain("references: [pkg]");
		expect(file).toContain("## Responsibility"); // body untouched

		expect(isError(await run("spec_update", { id: "m", remove: ["id"] }, root))).toBe(true);
		expect(isError(await run("spec_update", { id: "nope", set: { title: "x" } }, root))).toBe(true);
	});
});

test("spec_validate flags a dangling link then clean; spec_delete removes the file", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "a/SPEC.md", id: "a", type: "module-design", title: "A" },
			root,
		);
		await run("spec_update", { id: "a", addList: { "depends-on": ["ghost"] } }, root);

		const bad = await run("spec_validate", {}, root);
		const rb = bad.details as { danglingLinks: { target: string }[] };
		expect(rb.danglingLinks.some((l) => l.target === "ghost")).toBe(true);

		await run("spec_update", { id: "a", removeList: { "depends-on": ["ghost"] } }, root);
		const good = await run("spec_validate", {}, root);
		const rg = good.details as {
			danglingLinks: unknown[];
			duplicateIds: unknown[];
			parentCycles: unknown[];
		};
		expect(rg.danglingLinks.length + rg.duplicateIds.length + rg.parentCycles.length).toBe(0);

		expect(isError(await run("spec_delete", { id: "a" }, root))).toBe(false);
		expect(existsSync(join(root, "a/SPEC.md"))).toBe(false);
		expect(isError(await run("spec_get", { id: "a" }, root))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// spec_create — full frontmatter, ordering, scaffolds
// ---------------------------------------------------------------------------

test("spec_create writes canonical frontmatter order with inline arrays into nested dirs", async () => {
	await withRoot(async (root) => {
		const res = await run(
			"spec_create",
			{
				path: "deep/nested/dir/SPEC.md",
				id: "m",
				type: "module-design",
				status: "active",
				title: "M",
				parent: "p",
				dependsOn: ["d1", "d2"],
				references: ["r1"],
				implements: ["i1"],
				covers: ["c1"],
				tags: ["t1", "t2"],
			},
			root,
		);
		expect(isError(res)).toBe(false);
		expect((res.details as { path: string }).path).toBe("deep/nested/dir/SPEC.md");

		const file = readFileSync(join(root, "deep/nested/dir/SPEC.md"), "utf8");
		const order = [
			"id: m",
			"type: module-design",
			"status: active",
			"title: M",
			"parent: p",
			"depends-on: [d1, d2]",
			"references: [r1]",
			"implements: [i1]",
			"covers: [c1]",
			"tags: [t1, t2]",
		];
		let last = -1;
		for (const line of order) {
			const idx = file.indexOf(line);
			expect(idx).toBeGreaterThan(last);
			last = idx;
		}
		expect(file).toContain("## Responsibility");
	});
});

test("spec_create scaffolds body headings by type (and none for an unknown type)", async () => {
	await withRoot(async (root) => {
		const cases: Array<[string, string, string[]]> = [
			[
				"architecture-design",
				"arch.md",
				["## Drivers", "## Decisions", "## Invariants", "## Out of scope"],
			],
			["goal-and-requirements", "goal.md", ["## Goal", "## Scope"]],
			["task-spec", "task.md", ["## Purpose", "## Open items"]],
		];
		let n = 0;
		for (const [type, path, headings] of cases) {
			await run("spec_create", { path, id: `id-${n++}`, type, title: "T" }, root);
			const file = readFileSync(join(root, path), "utf8");
			for (const h of headings) expect(file).toContain(h);
		}
		await run(
			"spec_create",
			{ path: "weird.md", id: "weird", type: "made-up-type", title: "W" },
			root,
		);
		expect(readFileSync(join(root, "weird.md"), "utf8")).not.toContain("## ");
	});
});

// ---------------------------------------------------------------------------
// spec_get — forward + reverse links, missing targets, errors
// ---------------------------------------------------------------------------

test("spec_get resolves forward and reverse links and marks a missing target", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		await run("spec_update", { id: "mod-b", addList: { references: ["ghost"] } }, root);

		const res = await run("spec_get", { id: "mod-a" }, root);
		expect(isError(res)).toBe(false);
		const d = res.details as {
			links: Array<{ kind: string; target: string; path: string | null }>;
			reverseLinks: Array<{ kind: string; target: string; path: string | null }>;
		};
		expect(d.links).toContainEqual({ kind: "parent", target: "arch", path: "architecture.md" });
		expect(d.links).toContainEqual({ kind: "depends-on", target: "mod-b", path: "b/SPEC.md" });
		expect(d.links).toContainEqual({ kind: "references", target: "arch", path: "architecture.md" });
		// sub-a is a child of mod-a (reverse parent) and implements it (reverse implements).
		expect(d.reverseLinks).toContainEqual({
			kind: "parent",
			target: "sub-a",
			path: "a/sub/SPEC.md",
		});
		expect(d.reverseLinks).toContainEqual({
			kind: "implements",
			target: "sub-a",
			path: "a/sub/SPEC.md",
		});

		// mod-b now carries a dangling reference; spec_get renders it as (missing).
		const bad = await run("spec_get", { id: "mod-b" }, root);
		expect(text(bad)).toContain("ghost");
		expect(text(bad)).toContain("(missing)");
	});
});

test("spec_get errors on an unknown id", async () => {
	await withRoot(async (root) => {
		expect(isError(await run("spec_get", { id: "nope" }, root))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// spec_graph — direction, depth bounding, chosen edge, missing, errors
// ---------------------------------------------------------------------------

test("spec_graph subtree is bounded by depth", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		const ids = async (depth: number) =>
			(
				(await run("spec_graph", { root: "arch", direction: "subtree", depth }, root)).details as {
					nodes: Array<{ id: string }>;
				}
			).nodes
				.map((node) => node.id)
				.sort();
		expect(await ids(1)).toEqual(["arch", "mod-a", "mod-b"]);
		expect(await ids(2)).toEqual(["arch", "mod-a", "mod-b", "sub-a"]);
	});
});

test("spec_graph ancestors climbs the parent chain to the root", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		const d = (await run("spec_graph", { root: "sub-a", direction: "ancestors", depth: 10 }, root))
			.details as { nodes: Array<{ id: string }> };
		expect(d.nodes.map((node) => node.id).sort()).toEqual(["arch", "mod-a", "product", "sub-a"]);
	});
});

test("spec_graph neighbors traverses a chosen edge and reverse (defaulting to depends-on)", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		const neighborIds = async (params: Record<string, unknown>) =>
			(
				(await run("spec_graph", { root: "mod-a", direction: "neighbors", ...params }, root))
					.details as { nodes: Array<{ id: string }> }
			).nodes
				.map((node) => node.id)
				.sort();
		expect(await neighborIds({ edge: "depends-on" })).toEqual(["mod-a", "mod-b"]);
		// reverse of implements: mod-a is implemented by sub-a.
		expect(await neighborIds({ edge: "implements" })).toEqual(["mod-a", "sub-a"]);
		// edge omitted -> defaults to depends-on.
		expect(await neighborIds({})).toEqual(["mod-a", "mod-b"]);
	});
});

test("spec_graph errors on an unknown root and reports missing targets", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		expect(isError(await run("spec_graph", { root: "nope", direction: "subtree" }, root))).toBe(
			true,
		);

		await run("spec_update", { id: "mod-b", addList: { "depends-on": ["ghost"] } }, root);
		const res = await run(
			"spec_graph",
			{ root: "mod-b", direction: "neighbors", edge: "depends-on" },
			root,
		);
		expect((res.details as { missing: string[] }).missing).toContain("ghost");
		expect(text(res)).toContain("missing targets: ghost");
	});
});

// ---------------------------------------------------------------------------
// spec_grep — regex, case, filters, limit/truncation, empty
// ---------------------------------------------------------------------------

test("spec_grep supports regex, case-sensitivity, and an empty result", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "arch.md", id: "arch", type: "architecture-design", title: "Architecture" },
			root,
		);
		const rx = (await run("spec_grep", { pattern: "^## D", regex: true }, root)).details as {
			matches: Array<{ snippet: string }>;
		};
		expect(rx.matches.map((m) => m.snippet).sort()).toEqual(["## Decisions", "## Drivers"]);

		const caseSensitive = (await run("spec_grep", { pattern: "drivers", ignoreCase: false }, root))
			.details as { matches: unknown[] };
		expect(caseSensitive.matches).toHaveLength(0);
		const caseInsensitive = (await run("spec_grep", { pattern: "drivers", ignoreCase: true }, root))
			.details as { matches: unknown[] };
		expect(caseInsensitive.matches).toHaveLength(1);

		expect(text(await run("spec_grep", { pattern: "zzz-not-here" }, root))).toBe("No matches.");
	});
});

test("spec_grep caps at limit and flags truncation only when more exist", async () => {
	await withRoot(async (root) => {
		// The architecture scaffold has exactly four `#`-bearing heading lines.
		await run(
			"spec_create",
			{ path: "arch.md", id: "arch", type: "architecture-design", title: "Architecture" },
			root,
		);
		const cut = await run("spec_grep", { pattern: "#", limit: 2 }, root);
		expect((cut.details as { matches: unknown[] }).matches).toHaveLength(2);
		expect((cut.details as { truncated: boolean }).truncated).toBe(true);
		expect(text(cut)).toContain("(truncated)");

		const all = await run("spec_grep", { pattern: "#", limit: 4 }, root);
		expect((all.details as { truncated: boolean }).truncated).toBe(false);
	});
});

test("spec_grep surfaces a malformed regex as an error, not a crash", async () => {
	await withRoot(async (root) => {
		await run("spec_create", { path: "a.md", id: "a", type: "module-design", title: "A" }, root);
		const res = await run("spec_grep", { pattern: "(unclosed", regex: true }, root);
		expect(isError(res)).toBe(true);
		expect(text(res)).toContain("Invalid search pattern");
	});
});

test("spec_grep narrows by each metadata filter (type / tag / parent / depends-on)", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "a/SPEC.md", id: "a", type: "module-design", title: "A", tags: ["core"] },
			root,
		);
		await run(
			"spec_create",
			{
				path: "b/SPEC.md",
				id: "b",
				type: "submodule-design",
				title: "B",
				parent: "a",
				dependsOn: ["a"],
				tags: ["ui"],
			},
			root,
		);
		const paths = async (filter: Record<string, unknown>) =>
			(
				(await run("spec_grep", { pattern: "Responsibility", ...filter }, root)).details as {
					matches: Array<{ path: string }>;
				}
			).matches
				.map((m) => m.path)
				.sort();
		expect(await paths({ type: "submodule-design" })).toEqual(["b/SPEC.md"]);
		expect(await paths({ tag: "core" })).toEqual(["a/SPEC.md"]);
		expect(await paths({ parent: "a" })).toEqual(["b/SPEC.md"]);
		expect(await paths({ dependsOn: "a" })).toEqual(["b/SPEC.md"]);
		// Unfiltered: both specs carry a Responsibility heading.
		expect(await paths({})).toEqual(["a/SPEC.md", "b/SPEC.md"]);
	});
});

// ---------------------------------------------------------------------------
// spec_update — set/remove fields, link dedupe/prune, prose preservation, type
// ---------------------------------------------------------------------------

test("spec_update sets/removes fields, dedupes/prunes links, and preserves multi-line prose", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M", parent: "p", tags: ["x"] },
			root,
		);
		// Add a real multi-line body to prove prose survives a frontmatter-only edit.
		const abs = join(root, "m/SPEC.md");
		writeFileSync(abs, `${readFileSync(abs, "utf8")}\nSome prose.\n\n- a bullet\n- another\n`);

		await run(
			"spec_update",
			{
				id: "m",
				set: { title: "M v2", parent: "p2" },
				remove: ["tags"],
				addList: { "depends-on": ["d1", "d1", "d2"], references: ["r1"] },
			},
			root,
		);
		// Removing the only reference should prune the field entirely.
		await run("spec_update", { id: "m", removeList: { references: ["r1"] } }, root);

		const file = readFileSync(abs, "utf8");
		expect(file).toContain("title: M v2");
		expect(file).toContain("parent: p2");
		expect(file).not.toContain("tags:");
		expect(file).toContain("depends-on: [d1, d2]"); // duplicate d1 collapsed
		expect(file).not.toContain("references:"); // pruned when emptied
		expect(file).toContain("Some prose.");
		expect(file).toContain("- a bullet");
		expect(file).toContain("- another");
	});
});

test("spec_update can rewrite type via set but never removes id/type", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M" },
			root,
		);
		await run("spec_update", { id: "m", set: { type: "submodule-design" } }, root);
		expect((await run("spec_get", { id: "m" }, root)).details as { type: string }).toMatchObject({
			type: "submodule-design",
		});
		expect(isError(await run("spec_update", { id: "m", remove: ["type"] }, root))).toBe(true);
		expect(isError(await run("spec_update", { id: "m", remove: ["id"] }, root))).toBe(true);
	});
});

test("spec_update never un-specs: rejects renaming id via set and blanking id/type", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M" },
			root,
		);
		// Renaming a spec's id is refused outright (identity change; would dangle inbound links).
		expect(isError(await run("spec_update", { id: "m", set: { id: "m2" } }, root))).toBe(true);
		// Blanking id/type (an empty scalar is dropped on serialize) is refused before any write.
		expect(isError(await run("spec_update", { id: "m", set: { type: "" } }, root))).toBe(true);
		// The file is untouched and still a valid spec.
		const file = readFileSync(join(root, "m/SPEC.md"), "utf8");
		expect(file).toContain("id: m");
		expect(file).toContain("type: module-design");
	});
});

// ---------------------------------------------------------------------------
// spec_delete — errors, and the dangling links a delete leaves behind
// ---------------------------------------------------------------------------

test("spec_delete errors on an unknown id and leaves a dangling link behind", async () => {
	await withRoot(async (root) => {
		await seedGraph(root);
		expect(isError(await run("spec_delete", { id: "ghost" }, root))).toBe(true);

		// mod-a depends-on mod-b; deleting mod-b should dangle that edge.
		expect(isError(await run("spec_delete", { id: "mod-b" }, root))).toBe(false);
		expect(existsSync(join(root, "b/SPEC.md"))).toBe(false);

		const report = (await run("spec_validate", {}, root)).details as {
			danglingLinks: Array<{ from: string; target: string; kind: string }>;
		};
		expect(
			report.danglingLinks.some(
				(l) => l.from === "mod-a" && l.target === "mod-b" && l.kind === "depends-on",
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// spec_validate — clean, dangling across all kinds, duplicates, cycles
// ---------------------------------------------------------------------------

test("spec_validate: clean graph, then dangling links across every kind", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "a/SPEC.md", id: "a", type: "module-design", title: "A" },
			root,
		);
		expect(text(await run("spec_validate", {}, root))).toContain("valid: no issues");

		await run(
			"spec_update",
			{
				id: "a",
				set: { parent: "ghost-parent" },
				addList: {
					"depends-on": ["ghost-dep"],
					references: ["ghost-ref"],
					implements: ["ghost-impl"],
				},
			},
			root,
		);
		const r = (await run("spec_validate", {}, root)).details as {
			danglingLinks: Array<{ kind: string; target: string }>;
		};
		expect(r.danglingLinks.map((l) => `${l.kind}:${l.target}`).sort()).toEqual([
			"depends-on:ghost-dep",
			"implements:ghost-impl",
			"parent:ghost-parent",
			"references:ghost-ref",
		]);
	});
});

test("spec_validate: duplicate ids and parent cycles from pre-existing files", async () => {
	await withRoot(async (root) => {
		// Written before any tool call; the first index read globs them off disk.
		writeFileSync(join(root, "b1.md"), "---\nid: b\ntype: module-design\ntitle: B1\n---\n");
		writeFileSync(join(root, "b2.md"), "---\nid: b\ntype: module-design\ntitle: B2\n---\n");
		writeFileSync(
			join(root, "c1.md"),
			"---\nid: c1\ntype: module-design\ntitle: C1\nparent: c2\n---\n",
		);
		writeFileSync(
			join(root, "c2.md"),
			"---\nid: c2\ntype: module-design\ntitle: C2\nparent: c1\n---\n",
		);

		const res = await run("spec_validate", {}, root);
		const r = res.details as {
			duplicateIds: Array<{ id: string; paths: string[] }>;
			parentCycles: Array<{ ids: string[] }>;
		};
		expect(r.duplicateIds.some((d) => d.id === "b" && d.paths.length === 2)).toBe(true);
		expect(r.parentCycles.some((c) => [...c.ids].sort().join(",") === "c1,c2")).toBe(true);
		expect(text(res)).toContain("Duplicate ids");
		expect(text(res)).toContain("Parent cycles");
	});
});

test("spec_update manages covers/tags lists (append, dedupe, prune) via addList/removeList", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M", tags: ["a"] },
			root,
		);
		await run(
			"spec_update",
			{ id: "m", addList: { tags: ["a", "b"], covers: ["c1", "c2"] } },
			root,
		);
		const abs = join(root, "m/SPEC.md");
		expect(readFileSync(abs, "utf8")).toContain("covers: [c1, c2]");
		expect(readFileSync(abs, "utf8")).toContain("tags: [a, b]"); // existing "a" deduped

		await run("spec_update", { id: "m", removeList: { tags: ["a"] } }, root);
		expect(readFileSync(abs, "utf8")).toContain("tags: [b]");

		// Pruning a list to empty drops the field entirely.
		await run("spec_update", { id: "m", removeList: { covers: ["c1", "c2"] } }, root);
		expect(readFileSync(abs, "utf8")).not.toContain("covers:");
	});
});

test("spec_update rejects set on a list field and preserves comments + non-dialect fields", async () => {
	await withRoot(async (root) => {
		await run(
			"spec_create",
			{ path: "m/SPEC.md", id: "m", type: "module-design", title: "M" },
			root,
		);
		// Simulate a foreign repo: a nested map + a comment a vanilla-pi author might have written.
		const abs = join(root, "m/SPEC.md");
		writeFileSync(
			abs,
			readFileSync(abs, "utf8").replace("title: M\n", "title: M\nowner:\n  name: bob # keep me\n"),
		);

		// `set` on a list field is refused (it would corrupt the list into one wrong scalar entry).
		expect(isError(await run("spec_update", { id: "m", set: { tags: "a, b" } }, root))).toBe(true);

		// A real edit leaves the nested map + comment intact on disk.
		await run("spec_update", { id: "m", addList: { tags: ["t"] } }, root);
		const file = readFileSync(abs, "utf8");
		expect(file).toContain("owner:");
		expect(file).toContain("name: bob");
		expect(file).toContain("# keep me");
		expect(file).toContain("tags: [t]");
	});
});
