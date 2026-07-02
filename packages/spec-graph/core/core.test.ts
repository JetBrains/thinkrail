import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildGraph,
	FIELD_ORDER,
	FIELDS,
	graphSlice,
	grepSpecs,
	IDENTITY_FIELDS,
	isSpec,
	LINK_KINDS,
	LIST_FIELDS,
	LIST_LINK_FIELDS,
	parseFile,
	REQUIRED_FIELDS,
	SINGLE_LINK_FIELDS,
	SLICE_DIRECTIONS,
	SPEC_STATUSES,
	SPEC_TYPES,
	SpecIndex,
	serializeFrontmatter,
	updateFrontmatterText,
	validateGraph,
} from "./index.ts";

// ---------------------------------------------------------------------------
// vocabulary tuples (single source of truth for the unions + the tools' StringEnum schemas)
// ---------------------------------------------------------------------------

test("the finite-vocabulary tuples carry exactly their members", () => {
	expect([...IDENTITY_FIELDS]).toEqual(["id", "type"]);
	expect([...LINK_KINDS]).toEqual(["parent", "depends-on", "references", "implements"]);
	expect([...SLICE_DIRECTIONS]).toEqual(["subtree", "ancestors", "neighbors"]);
	expect([...SPEC_TYPES]).toEqual([
		"goal-and-requirements",
		"architecture-design",
		"module-design",
		"submodule-design",
		"task-spec",
	]);
	expect([...SPEC_STATUSES]).toEqual(["draft", "active", "stale", "done", "deprecated"]);
});

test("FIELDS is the single source for field names and the field tuples derive from it", () => {
	expect(FIELDS).toEqual({
		id: "id",
		type: "type",
		status: "status",
		title: "title",
		parent: "parent",
		dependsOn: "depends-on",
		references: "references",
		implements: "implements",
		covers: "covers",
		tags: "tags",
	});
	// The tuples are composed from FIELDS values — renaming a field in FIELDS moves all of them together.
	expect([...REQUIRED_FIELDS]).toEqual([FIELDS.id, FIELDS.type, FIELDS.title]);
	expect([...IDENTITY_FIELDS]).toEqual([FIELDS.id, FIELDS.type]);
	expect([...SINGLE_LINK_FIELDS]).toEqual([FIELDS.parent]);
	expect([...LIST_LINK_FIELDS]).toEqual([FIELDS.dependsOn, FIELDS.references, FIELDS.implements]);
	expect([...LIST_FIELDS]).toEqual([
		FIELDS.dependsOn,
		FIELDS.references,
		FIELDS.implements,
		FIELDS.covers,
		FIELDS.tags,
	]);
	expect([...FIELD_ORDER]).toEqual([
		FIELDS.id,
		FIELDS.type,
		FIELDS.status,
		FIELDS.title,
		FIELDS.parent,
		FIELDS.dependsOn,
		FIELDS.references,
		FIELDS.implements,
		FIELDS.covers,
		FIELDS.tags,
	]);
});

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test("parseFile splits frontmatter (scalars + inline arrays) from body", () => {
	const { frontmatter, body } = parseFile(
		"---\nid: foo\ntype: module-design\ntitle: Foo\ndepends-on: [a, b]\ntags: [x]\n---\n\n## Body\ntext\n",
	);
	expect(frontmatter).toEqual({
		id: "foo",
		type: "module-design",
		title: "Foo",
		"depends-on": ["a", "b"],
		tags: ["x"],
	});
	expect(body).toBe("\n## Body\ntext\n");
});

test("parseFile reads block-style (multi-line) YAML arrays, normalizing them to a string list", () => {
	// A human or pi's normal edit tool may write a block sequence; the yaml lib reads it (the old
	// hand-rolled parser only understood inline `[a, b]`). We re-serialize it back inline.
	const { frontmatter } = parseFile(
		"---\nid: m\ntype: module-design\ntitle: M\ndepends-on:\n  - a\n  - b\n---\nbody\n",
	);
	expect(frontmatter?.["depends-on"]).toEqual(["a", "b"]);
});

test("parseFile returns null frontmatter for a malformed YAML block instead of throwing", () => {
	const { frontmatter, body } = parseFile("---\nid: m\n  bad: : indent\n\t- x\n---\nbody\n");
	expect(frontmatter).toBeNull();
	expect(body).toContain("body");
});

test("parseFile returns null frontmatter without a leading fence", () => {
	const { frontmatter, body } = parseFile("# Just prose\nno fence");
	expect(frontmatter).toBeNull();
	expect(body).toBe("# Just prose\nno fence");
});

test("isSpec requires id and type", () => {
	expect(isSpec({ id: "a", type: "t" })).toBe(true);
	expect(isSpec({ id: "a" })).toBe(false);
	expect(isSpec({ type: "t" })).toBe(false);
	expect(isSpec(null)).toBe(false);
});

test("serializeFrontmatter emits in the given key order, arrays inline, empties dropped", () => {
	// No reordering: it serializes the object as given. `spec_create` builds the object in FIELD_ORDER;
	// edits preserve a file's own field order (see updateFrontmatterText).
	const out = serializeFrontmatter({
		id: "foo",
		type: "module-design",
		title: "T",
		"depends-on": [],
		covers: ["c"],
		tags: ["x", "y"],
	});
	expect(out).toBe("---\nid: foo\ntype: module-design\ntitle: T\ncovers: [c]\ntags: [x, y]\n---\n");
});

test("serializeFrontmatter emits status where the object places it", () => {
	const out = serializeFrontmatter({
		id: "foo",
		type: "module-design",
		status: "active",
		title: "T",
	});
	expect(out).toBe("---\nid: foo\ntype: module-design\nstatus: active\ntitle: T\n---\n");
});

test("serialize <-> parse round-trips", () => {
	const fm = { id: "foo", type: "module-design", title: "Foo", "depends-on": ["a", "b"] };
	const { frontmatter } = parseFile(`${serializeFrontmatter(fm)}\nbody`);
	expect(frontmatter).toEqual(fm);
});

test("serialize <-> parse round-trips a list item containing a comma", () => {
	// The serializer must quote a comma-bearing item and the parser must split quote-aware, else the
	// item is silently torn into two on the next read.
	const fm = { id: "x", type: "t", title: "T", tags: ["hello, world", "b"] };
	const { frontmatter } = parseFile(`${serializeFrontmatter(fm)}\nbody`);
	expect(frontmatter).toEqual(fm);
});

test("parseFile strips a trailing CR so a CRLF-authored last field isn't corrupted", () => {
	// Splitting on \n alone leaves the final frontmatter line's \r inside the scalar (title -> "T\r").
	const { frontmatter } = parseFile(
		"---\r\nid: my-spec\r\ntype: module-design\r\ntitle: T\r\n---\r\nbody\r\n",
	);
	expect(frontmatter).toEqual({ id: "my-spec", type: "module-design", title: "T" });
});

test("parseFile survives a CRLF file whose last frontmatter line is a flow list", () => {
	// Before the CR strip, the stray \r made the flow-list line throw -> null -> silently not-a-spec.
	const { frontmatter } = parseFile(
		"---\r\nid: my-spec\r\ntype: module-design\r\ntags: [a, b]\r\n---\r\nbody\r\n",
	);
	expect(frontmatter).toEqual({ id: "my-spec", type: "module-design", tags: ["a", "b"] });
});

// ---------------------------------------------------------------------------
// updateFrontmatterText — the lossless in-place write path
// ---------------------------------------------------------------------------

test("updateFrontmatterText preserves comments and non-dialect fields through an edit", () => {
	// The read model coerces frontmatter to a scalar/string-array dialect (dropping nested maps + comments);
	// the write path must NOT, or any edit would silently delete what it doesn't understand.
	const file = [
		"---",
		"id: a # the slug",
		"type: module-design",
		"# a standalone note",
		"owner:",
		"  name: bob",
		"  team: infra",
		"tags: [x, y]",
		"---",
		"prose body",
		"",
	].join("\n");
	const res = updateFrontmatterText(file, { addList: { tags: ["z"] }, set: { status: "active" } });
	expect("content" in res).toBe(true);
	const content = (res as { content: string }).content;
	expect(content).toContain("owner:");
	expect(content).toContain("name: bob");
	expect(content).toContain("team: infra");
	expect(content).toContain("# the slug");
	expect(content).toContain("# a standalone note");
	expect(content).toContain("tags: [x, y, z]");
	expect(content).toContain("status: active");
	expect(content).toContain("prose body");
	// Still the same spec on the next read.
	const { frontmatter } = parseFile(content);
	expect(frontmatter?.id).toBe("a");
	expect(frontmatter?.tags).toEqual(["x", "y", "z"]);
});

test("updateFrontmatterText writes the file back in its original CRLF line ending", () => {
	const file = "---\r\nid: a\r\ntype: module-design\r\ntitle: T\r\n---\r\nbody line\r\n";
	const res = updateFrontmatterText(file, { set: { title: "T2" } }) as { content: string };
	expect(res.content).toContain("title: T2");
	expect(res.content).toContain("body line");
	// No lone LF: every newline is a CRLF (no mixed endings left behind).
	expect(/(?<!\r)\n/.test(res.content)).toBe(false);
});

test("updateFrontmatterText rejects set on a list field (use addList/removeList instead)", () => {
	// `set: {tags: "a, b"}` would list-coerce to one wrong entry ["a, b"]; the tool routes lists elsewhere.
	const res = updateFrontmatterText("---\nid: a\ntype: t\n---\nbody\n", { set: { tags: "a, b" } });
	expect("error" in res).toBe(true);
});

test("updateFrontmatterText never un-specs: refuses to blank/rename/remove id/type", () => {
	const file = "---\nid: a\ntype: module-design\ntitle: T\n---\nbody\n";
	expect("error" in updateFrontmatterText(file, { set: { id: "b" } })).toBe(true);
	expect("error" in updateFrontmatterText(file, { set: { type: "" } })).toBe(true);
	expect("error" in updateFrontmatterText(file, { remove: ["id"] })).toBe(true);
});

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

const entries = [
	{ path: "root/SPEC.md", frontmatter: { id: "root", type: "architecture-design", title: "Root" } },
	{
		path: "a/SPEC.md",
		frontmatter: {
			id: "a",
			type: "module-design",
			title: "A",
			parent: "root",
			"depends-on": ["b"],
		},
	},
	{
		path: "b/SPEC.md",
		frontmatter: { id: "b", type: "module-design", title: "B", parent: "root" },
	},
];

test("buildGraph derives forward + reverse edges", () => {
	const g = buildGraph(entries);
	expect([...g.nodes.keys()].sort()).toEqual(["a", "b", "root"]);
	expect(g.forward["depends-on"].get("a")).toEqual(["b"]);
	expect(g.reverse["depends-on"].get("b")).toEqual(["a"]);
	expect(g.reverse.parent.get("root")?.sort()).toEqual(["a", "b"]);
});

test("buildGraph tracks duplicate ids (first file wins the node)", () => {
	const g = buildGraph([
		{ path: "one.md", frontmatter: { id: "dup", type: "t" } },
		{ path: "two.md", frontmatter: { id: "dup", type: "t" } },
	]);
	expect(g.nodes.get("dup")?.path).toBe("one.md");
	expect(g.duplicateIds.get("dup")).toEqual(["one.md", "two.md"]);
});

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

test("graphSlice subtree walks children down the parent tree", () => {
	const slice = graphSlice(buildGraph(entries), { root: "root", direction: "subtree", depth: 1 });
	expect(slice.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "root"]);
});

test("graphSlice ancestors walks up the parent chain", () => {
	const slice = graphSlice(buildGraph(entries), { root: "a", direction: "ancestors", depth: 5 });
	expect(slice.nodes.map((n) => n.id).sort()).toEqual(["a", "root"]);
});

test("graphSlice neighbors traverses a chosen edge and its reverse", () => {
	const g = buildGraph(entries);
	expect(
		graphSlice(g, { root: "a", direction: "neighbors", edge: "depends-on" })
			.nodes.map((n) => n.id)
			.sort(),
	).toEqual(["a", "b"]);
	expect(
		graphSlice(g, { root: "b", direction: "neighbors", edge: "depends-on" })
			.nodes.map((n) => n.id)
			.sort(),
	).toEqual(["a", "b"]);
});

test("graphSlice neighbors records each edge once across depth", () => {
	// a -> b -> c along depends-on: at depth 2 the a->b edge is reachable forward (from a) and
	// reverse (incoming to b); it must appear exactly once.
	const g = buildGraph([
		{ path: "a.md", frontmatter: { id: "a", type: "t", "depends-on": ["b"] } },
		{ path: "b.md", frontmatter: { id: "b", type: "t", "depends-on": ["c"] } },
		{ path: "c.md", frontmatter: { id: "c", type: "t" } },
	]);
	const slice = graphSlice(g, { root: "a", direction: "neighbors", edge: "depends-on", depth: 2 });
	const keys = slice.edges.map((e) => `${e.from}-${e.kind}-${e.to}`);
	expect(keys.sort()).toEqual(["a-depends-on-b", "b-depends-on-c"]);
});

test("grepSpecs matches with metadata filters", () => {
	const content = [
		{
			path: "a.md",
			content: "hello world\nfoo bar",
			frontmatter: { id: "a", type: "module-design", tags: ["x"] },
		},
		{ path: "b.md", content: "hello there", frontmatter: { id: "b", type: "task-spec" } },
	];
	expect(grepSpecs(content, { pattern: "hello" }).matches.map((m) => m.path)).toEqual([
		"a.md",
		"b.md",
	]);
	expect(
		grepSpecs(content, { pattern: "hello", type: "task-spec" }).matches.map((m) => m.path),
	).toEqual(["b.md"]);
	expect(grepSpecs(content, { pattern: "hello", tag: "x" }).matches.map((m) => m.path)).toEqual([
		"a.md",
	]);
	expect(grepSpecs(content, { pattern: "^foo", regex: true }).matches[0]?.line).toBe(2);
});

test("grepSpecs marks truncated only when a match exists beyond the limit", () => {
	const content = [{ path: "a.md", content: "x\nx\nx", frontmatter: { id: "a", type: "t" } }];
	// Exactly `limit` matches: capped but not truncated (no further match cut off).
	const exact = grepSpecs(content, { pattern: "x", limit: 3 });
	expect(exact.matches).toHaveLength(3);
	expect(exact.truncated).toBe(false);
	// Fewer than the matches available: capped and truncated.
	const cut = grepSpecs(content, { pattern: "x", limit: 2 });
	expect(cut.matches).toHaveLength(2);
	expect(cut.truncated).toBe(true);
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

test("validateGraph flags dangling links, duplicate ids, and parent cycles", () => {
	const g = buildGraph([
		{ path: "a.md", frontmatter: { id: "a", type: "t", parent: "b", "depends-on": ["ghost"] } },
		{ path: "b.md", frontmatter: { id: "b", type: "t", parent: "a" } },
		{ path: "c1.md", frontmatter: { id: "c", type: "t" } },
		{ path: "c2.md", frontmatter: { id: "c", type: "t" } },
	]);
	const report = validateGraph(g);
	expect(report.danglingLinks).toContainEqual({
		from: "a",
		fromPath: "a.md",
		kind: "depends-on",
		target: "ghost",
	});
	expect(report.duplicateIds).toContainEqual({ id: "c", paths: ["c1.md", "c2.md"] });
	expect(report.parentCycles).toHaveLength(1);
	expect(report.parentCycles[0]?.ids.sort()).toEqual(["a", "b"]);
});

// ---------------------------------------------------------------------------
// store (on-demand read model over the filesystem)
// ---------------------------------------------------------------------------

function withIndexRoot(fn: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "spec-index-"));
	try {
		fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("SpecIndex globs specs, ignoring non-specs and node_modules", () => {
	withIndexRoot((root) => {
		mkdirSync(join(root, "pkg"), { recursive: true });
		mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
		writeFileSync(
			join(root, "pkg", "SPEC.md"),
			"---\nid: pkg\ntype: module-design\ntitle: Pkg\n---\n",
		);
		writeFileSync(join(root, "README.md"), "# not a spec\n");
		writeFileSync(
			join(root, "node_modules", "dep", "SPEC.md"),
			"---\nid: dep\ntype: module-design\ntitle: Dep\n---\n",
		);

		const index = new SpecIndex(root);
		expect([...index.graph().nodes.keys()]).toEqual(["pkg"]);
	});
});

test("SpecIndex re-globs to pick up an externally added spec on the next read", () => {
	withIndexRoot((root) => {
		const index = new SpecIndex(root);
		expect([...index.graph().nodes.keys()]).toEqual([]);
		// A brand-new file appears on disk; the next read re-globs (no cache, no refresh call).
		writeFileSync(join(root, "new.md"), "---\nid: new\ntype: module-design\ntitle: New\n---\n");
		expect([...index.graph().nodes.keys()]).toEqual(["new"]);
		expect(index.pathForId("new")).toBe("new.md");
	});
});

test("SpecIndex re-parses an externally modified spec", () => {
	withIndexRoot((root) => {
		const abs = join(root, "m.md");
		writeFileSync(abs, "---\nid: m\ntype: module-design\ntitle: Old\n---\n");
		const index = new SpecIndex(root);
		expect(index.graph().nodes.get("m")?.title).toBe("Old");
		// An external edit (pi's normal write/edit) changes the frontmatter; the next read reflects it.
		writeFileSync(abs, "---\nid: m\ntype: module-design\ntitle: New\ntags: [x]\n---\n");
		const node = index.graph().nodes.get("m");
		expect(node?.title).toBe("New");
		expect(node?.frontmatter.tags).toEqual(["x"]);
	});
});

test("SpecIndex drops an externally deleted spec", () => {
	withIndexRoot((root) => {
		writeFileSync(join(root, "a.md"), "---\nid: a\ntype: t\ntitle: A\n---\n");
		writeFileSync(join(root, "b.md"), "---\nid: b\ntype: t\ntitle: B\n---\n");
		const index = new SpecIndex(root);
		expect([...index.graph().nodes.keys()].sort()).toEqual(["a", "b"]);
		rmSync(join(root, "a.md"));
		expect([...index.graph().nodes.keys()]).toEqual(["b"]);
		expect(index.pathForId("a")).toBeUndefined();
	});
});

test("SpecIndex memoizes the graph and rebuilds it only when the spec set changes", () => {
	withIndexRoot((root) => {
		const abs = join(root, "m.md");
		writeFileSync(abs, "---\nid: m\ntype: t\ntitle: M\n---\n");
		const index = new SpecIndex(root);
		const g1 = index.graph();
		// Nothing changed on disk -> same instance (the rebuild + re-parse are skipped).
		expect(index.graph()).toBe(g1);
		// An external edit changes (mtimeMs, size) -> the next read rebuilds a fresh graph.
		writeFileSync(abs, "---\nid: m\ntype: t\ntitle: M2\n---\n");
		const g2 = index.graph();
		expect(g2).not.toBe(g1);
		expect(g2.nodes.get("m")?.title).toBe("M2");
	});
});

test("SpecIndex.recordForId returns the cached read (path + text + frontmatter) for update to reuse", () => {
	withIndexRoot((root) => {
		const abs = join(root, "m.md");
		writeFileSync(abs, "---\nid: m\ntype: module-design\ntitle: M\n---\nbody line\n");
		const index = new SpecIndex(root);
		const record = index.recordForId("m");
		expect(record?.rel).toBe("m.md");
		expect(record?.abs).toBe(abs);
		expect(record?.frontmatter.title).toBe("M");
		// Text is retained for specs, so spec_update can re-split the body without a second disk read.
		expect(record?.content.includes("body line")).toBe(true);
		expect(index.recordForId("nope")).toBeUndefined();
	});
});

test("SpecIndex tracks a file entering and leaving spec-hood via its frontmatter", () => {
	withIndexRoot((root) => {
		const abs = join(root, "x.md");
		writeFileSync(abs, "# just prose, no frontmatter\n");
		const index = new SpecIndex(root);
		expect([...index.graph().nodes.keys()]).toEqual([]);
		// Gains frontmatter -> becomes a spec.
		writeFileSync(abs, "---\nid: x\ntype: module-design\ntitle: X\n---\nbody\n");
		expect([...index.graph().nodes.keys()]).toEqual(["x"]);
		// Loses its id -> no longer a spec.
		writeFileSync(abs, "---\ntype: module-design\ntitle: X\n---\nbody\n");
		expect([...index.graph().nodes.keys()]).toEqual([]);
	});
});
