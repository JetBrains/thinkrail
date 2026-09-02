import { expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
	buildGraph,
	DEFAULT_GREP_LIMIT,
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
	resolveSpecPath,
	SINGLE_LINK_FIELDS,
	SLICE_DIRECTIONS,
	SPEC_FILE_EXTENSION,
	SPEC_STATUSES,
	SPEC_TYPES,
	SpecIndex,
	serializeFrontmatter,
	updateFrontmatterText,
	validateGraph,
} from "./index.ts";
import {
	compareWalkEntries,
	hasWindowsNamespaceSyntax,
	isPathInsideRoot,
	resolvePathSegment,
	type SegmentResolution,
	toWalkEntry,
} from "./store.ts";

function probeFilesystem(): {
	foldsCase: boolean;
	foldsUnicode: boolean;
	deniesListing: boolean;
} {
	const probe = mkdtempSync(join(tmpdir(), "spec-probe-"));
	try {
		for (const name of ["CaseProbe", "caf\u00e9", "cafe\u0301"]) {
			mkdirSync(join(probe, name), { recursive: true });
		}
		const foldsCase = existsSync(join(probe, "caseprobe"));
		const foldsUnicode = readdirSync(probe).length < 3;
		return {
			foldsCase,
			foldsUnicode,
			deniesListing: withUnlistableDirectory(probe, refusesListing),
		};
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

function withUnlistableDirectory<T>(parent: string, fn: (dir: string) => T): T {
	const dir = join(parent, "unlistable");
	mkdirSync(dir, { recursive: true });
	chmodSync(dir, 0o311);
	try {
		return fn(dir);
	} finally {
		chmodSync(dir, 0o755);
	}
}

function refusesListing(dir: string): boolean {
	try {
		readdirSync(dir);
		return false;
	} catch {
		return true;
	}
}

const { foldsCase, foldsUnicode, deniesListing } = probeFilesystem();
const caseFolding = test.skipIf(!foldsCase);
const spellingPreserving = test.skipIf(foldsUnicode);
const listingDenied = test.skipIf(!deniesListing);
const windowsOnly = test.skipIf(process.platform !== "win32");
const nonWindows = test.skipIf(process.platform === "win32");

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
	const fm = { id: "x", type: "t", title: "T", tags: ["hello, world", "b"] };
	const { frontmatter } = parseFile(`${serializeFrontmatter(fm)}\nbody`);
	expect(frontmatter).toEqual(fm);
});

test("parseFile strips a trailing CR so a CRLF-authored last field isn't corrupted", () => {
	const { frontmatter } = parseFile(
		"---\r\nid: my-spec\r\ntype: module-design\r\ntitle: T\r\n---\r\nbody\r\n",
	);
	expect(frontmatter).toEqual({ id: "my-spec", type: "module-design", title: "T" });
});

test("parseFile survives a CRLF file whose last frontmatter line is a flow list", () => {
	const { frontmatter } = parseFile(
		"---\r\nid: my-spec\r\ntype: module-design\r\ntags: [a, b]\r\n---\r\nbody\r\n",
	);
	expect(frontmatter).toEqual({ id: "my-spec", type: "module-design", tags: ["a", "b"] });
});

test("updateFrontmatterText preserves comments and non-dialect fields through an edit", () => {
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
	const { frontmatter } = parseFile(content);
	expect(frontmatter?.id).toBe("a");
	expect(frontmatter?.tags).toEqual(["x", "y", "z"]);
});

test("updateFrontmatterText writes the file back in its original CRLF line ending", () => {
	const file = "---\r\nid: a\r\ntype: module-design\r\ntitle: T\r\n---\r\nbody line\r\n";
	const res = updateFrontmatterText(file, { set: { title: "T2" } }) as { content: string };
	expect(res.content).toContain("title: T2");
	expect(res.content).toContain("body line");
	expect(/(?<!\r)\n/.test(res.content)).toBe(false);
});

test("updateFrontmatterText leaves the prose body byte-identical, mixed line endings included", () => {
	const body = "# Body\nplain line\r\nanother\n";
	const res = updateFrontmatterText(`---\nid: a\ntype: module-design\ntitle: T\n---\n${body}`, {
		set: { title: "T2" },
	}) as { content: string };
	expect(res.content).toBe(`---\nid: a\ntype: module-design\ntitle: T2\n---\n${body}`);
});

test("updateFrontmatterText reads the line ending from the frontmatter, not from any body line", () => {
	const lfWithOneCrlfInProse = "---\nid: a\ntype: module-design\ntitle: T\n---\nprose\r\n";
	const res = updateFrontmatterText(lfWithOneCrlfInProse, { set: { title: "T2" } }) as {
		content: string;
	};
	expect(res.content.startsWith("---\nid: a\n")).toBe(true);
	expect(res.content.endsWith("prose\r\n")).toBe(true);
});

test("updateFrontmatterText keeps a leading BOM the split step strips off", () => {
	const file = "\ufeff---\nid: a\ntype: module-design\ntitle: T\n---\nbody\n";
	const res = updateFrontmatterText(file, { set: { title: "T2" } }) as { content: string };
	expect(res.content.startsWith("\ufeff")).toBe(true);
	expect(parseFile(res.content).frontmatter?.title).toBe("T2");
});

test("updateFrontmatterText rejects set on a list field (use addList/removeList instead)", () => {
	const res = updateFrontmatterText("---\nid: a\ntype: t\n---\nbody\n", { set: { tags: "a, b" } });
	expect("error" in res).toBe(true);
});

test("updateFrontmatterText never un-specs: refuses to blank/rename/remove id/type", () => {
	const file = "---\nid: a\ntype: module-design\ntitle: T\n---\nbody\n";
	expect("error" in updateFrontmatterText(file, { set: { id: "b" } })).toBe(true);
	expect("error" in updateFrontmatterText(file, { set: { type: "" } })).toBe(true);
	expect("error" in updateFrontmatterText(file, { remove: ["id"] })).toBe(true);
});

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
	const exact = grepSpecs(content, { pattern: "x", limit: 3 });
	expect(exact.matches).toHaveLength(3);
	expect(exact.truncated).toBe(false);
	const cut = grepSpecs(content, { pattern: "x", limit: 2 });
	expect(cut.matches).toHaveLength(2);
	expect(cut.truncated).toBe(true);
});

test("grepSpecs strips the CR of a CRLF spec so anchored patterns still match", () => {
	const entries = [
		{
			path: "a.md",
			content: "---\r\nid: a\r\ntype: t\r\n---\r\nhello world\r\n",
			frontmatter: { id: "a", type: "t" },
		},
	];
	expect(grepSpecs(entries, { pattern: "world$", regex: true }).matches).toHaveLength(1);
	expect(grepSpecs(entries, { pattern: "^hello", regex: true }).matches[0]?.snippet).toBe(
		"hello world",
	);
});

test("grepSpecs falls back to the default limit rather than reporting a silent truncation", () => {
	const content = [{ path: "a.md", content: "x\nx", frontmatter: { id: "a", type: "t" } }];
	for (const limit of [0, -5, 0.5]) {
		const res = grepSpecs(content, { pattern: "x", limit });
		expect(res.matches).toHaveLength(2);
		expect(res.truncated).toBe(false);
	}
	expect(DEFAULT_GREP_LIMIT).toBe(200);
});

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
		expect(index.graph()).toBe(g1);
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
		writeFileSync(abs, "---\nid: x\ntype: module-design\ntitle: X\n---\nbody\n");
		expect([...index.graph().nodes.keys()]).toEqual(["x"]);
		writeFileSync(abs, "---\ntype: module-design\ntitle: X\n---\nbody\n");
		expect([...index.graph().nodes.keys()]).toEqual([]);
	});
});

function withProject(fn: (root: string, outer: string) => void): void {
	withIndexRoot((outer) => {
		const root = join(outer, "project");
		mkdirSync(root, { recursive: true });
		fn(root, outer);
	});
}

const ok = (r: ReturnType<typeof resolveSpecPath>, root: string): string => {
	if ("error" in r) throw new Error(`expected a resolved path, got: ${r.error}`);
	expect(r.abs).toBe(join(root, ...r.rel.split("/")));
	return r.rel;
};

test("resolveSpecPath returns the canonical relative path the index would report", () => {
	withProject((root) => {
		expect(ok(resolveSpecPath(root, "SPEC.md"), root)).toBe("SPEC.md");
		expect(ok(resolveSpecPath(root, "packages/core/SPEC.md"), root)).toBe("packages/core/SPEC.md");
		expect(ok(resolveSpecPath(root, "./packages/core/SPEC.md"), root)).toBe(
			"packages/core/SPEC.md",
		);
		expect(ok(resolveSpecPath(root, "pkg/./sub/../SPEC.md"), root)).toBe("pkg/SPEC.md");
		expect(SPEC_FILE_EXTENSION).toBe(".md");
	});
});

test("resolveSpecPath rejects every path the index could never see", () => {
	withProject((root) => {
		for (const path of [
			"",
			"../outside.md",
			"pkg/../../outside.md",
			"/etc/outside.md",
			"notes/spec.txt",
			"node_modules/dep/SPEC.md",
			"pkg/dist/SPEC.md",
		]) {
			expect(resolveSpecPath(root, path)).toHaveProperty("error");
		}
	});
});

test("Windows drive and stream syntax is never a root-relative spec path", () => {
	for (const path of [
		"C:SPEC.md",
		"C:..\\..\\outside.md",
		"notes.txt:SPEC.md",
		"dir\\notes.txt:SPEC.md",
		"\\rooted\\SPEC.md",
		"\\\\server\\share\\SPEC.md",
	]) {
		expect(hasWindowsNamespaceSyntax(path)).toBe(true);
	}
	for (const path of ["SPEC.md", "dir\\SPEC.md"]) {
		expect(hasWindowsNamespaceSyntax(path)).toBe(false);
	}
});

test("the final containment gate catches Windows drive-relative traversal after joining", () => {
	const root = "C:\\repo";
	const attack = "C:..\\..\\..\\outside.md";
	let target = root;
	for (const segment of win32.normalize(attack).split(win32.sep)) {
		target = win32.join(target, segment);
	}

	expect(win32.isAbsolute(attack)).toBe(false);
	expect(target).toBe("C:\\outside.md");
	expect(isPathInsideRoot(root, "C:\\repo\\docs\\SPEC.md", win32)).toBe(true);
	expect(isPathInsideRoot(root, target, win32)).toBe(false);
	expect(isPathInsideRoot(root, "D:\\outside.md", win32)).toBe(false);
});

windowsOnly("resolveSpecPath rejects Windows drive-relative and stream paths", () => {
	withProject((root) => {
		for (const path of ["C:..\\..\\outside.md", "notes.txt:SPEC.md"]) {
			expect(resolveSpecPath(root, path)).toHaveProperty("error");
		}
	});
});

nonWindows("Windows-only syntax keeps its literal index identity on POSIX", () => {
	withProject((root) => {
		const names = ["notes.txt:SPEC.md", "dir\\SPEC.md"];
		for (const [index, path] of names.entries()) {
			const resolved = resolveSpecPath(root, path);
			if ("error" in resolved) throw new Error(`expected a resolved path, got: ${resolved.error}`);
			writeFileSync(
				resolved.abs,
				`---\nid: literal-${index}\ntype: module-design\ntitle: Literal\n---\n`,
			);
		}

		const graph = new SpecIndex(root).graph();
		expect(graph.nodes.get("literal-0")?.path).toBe(names[0]);
		expect(graph.nodes.get("literal-1")?.path).toBe(names[1]);
	});
});

test("resolveSpecPath rejects a symlinked directory even when it points back inside the root", () => {
	withProject((root, outer) => {
		mkdirSync(join(root, "real"), { recursive: true });
		mkdirSync(join(root, "node_modules", "hidden"), { recursive: true });
		mkdirSync(join(outer, "elsewhere"), { recursive: true });
		symlinkSync(join(outer, "elsewhere"), join(root, "away"), "dir");
		symlinkSync(join(outer, "never-created"), join(root, "gone"), "dir");
		symlinkSync(join(root, "node_modules", "hidden"), join(root, "docs"), "dir");
		symlinkSync(join(root, "real"), join(root, "alias"), "dir");

		expect(resolveSpecPath(root, "away/evil.md")).toHaveProperty("error");
		expect(resolveSpecPath(root, "gone/evil.md")).toHaveProperty("error");
		expect(resolveSpecPath(root, "docs/ghost.md")).toHaveProperty("error");
		expect(resolveSpecPath(root, "alias/SPEC.md")).toHaveProperty("error");
		expect(ok(resolveSpecPath(root, "real/SPEC.md"), root)).toBe("real/SPEC.md");
	});
});

test("resolveSpecPath rejects a symlink at the leaf, dangling or not", () => {
	withProject((root, outer) => {
		symlinkSync(join(outer, "never-created.md"), join(root, "dangling.md"));
		writeFileSync(join(outer, "real-outside.md"), "outside\n");
		symlinkSync(join(outer, "real-outside.md"), join(root, "live.md"));

		expect(resolveSpecPath(root, "dangling.md")).toHaveProperty("error");
		expect(resolveSpecPath(root, "live.md")).toHaveProperty("error");
	});
});

const resolvedName = (r: SegmentResolution): string => {
	if ("error" in r) throw new Error(`expected a resolved segment, got: ${r.error}`);
	return r.name;
};

test("resolvePathSegment canonicalizes to the on-disk spelling and never guesses", () => {
	expect(resolvedName(resolvePathSegment(["docs", "pkg"], "docs", true))).toBe("docs");
	expect(resolvedName(resolvePathSegment(["Docs", "pkg"], "docs", true))).toBe("Docs");
	expect(resolvedName(resolvePathSegment(["caf\u00e9"], "cafe\u0301", true))).toBe("caf\u00e9");
	expect(resolvedName(resolvePathSegment(["docs"], "Docs", false))).toBe("Docs");
	expect(resolvedName(resolvePathSegment(["docs"], "SPEC.md", false))).toBe("SPEC.md");

	expect(resolvePathSegment(["Docs", "docs"], "DOCS", true)).toHaveProperty("error");
	expect(resolvePathSegment(["pkg"], "docs", true)).toHaveProperty("error");
});

test("resolvePathSegment refuses an ignored directory in any spelling, existing or not", () => {
	expect(resolvePathSegment(["node_modules"], "node_modules", true)).toHaveProperty("error");
	expect(resolvePathSegment(["node_modules"], "NODE_MODULES", true)).toHaveProperty("error");
	for (const spelling of [
		"node_modules",
		"NODE_MODULES",
		"Node_Modules",
		"DIST",
		"BUILD",
		".GIT",
	]) {
		expect(resolvePathSegment([], spelling, false)).toHaveProperty("error");
	}
});

caseFolding("resolveSpecPath resolves a case alias to the spelling the index will walk", () => {
	withProject((root) => {
		mkdirSync(join(root, "node_modules"), { recursive: true });
		mkdirSync(join(root, "docs"), { recursive: true });

		expect(resolveSpecPath(root, "NODE_MODULES/SPEC.md")).toHaveProperty("error");
		expect(ok(resolveSpecPath(root, "Docs/SPEC.md"), root)).toBe("docs/SPEC.md");
		expect(ok(resolveSpecPath(root, "Docs/Nested/SPEC.md"), root)).toBe("docs/Nested/SPEC.md");

		writeFileSync(
			join(root, "docs", "SPEC.MD"),
			"---\nid: shouty\ntype: module-design\ntitle: S\n---\n",
		);
		expect(resolveSpecPath(root, "docs/spec.md")).toHaveProperty("error");
	});
});

test("resolveSpecPath fails closed when the root does not exist", () => {
	expect(resolveSpecPath(join(tmpdir(), "spec-index-definitely-absent"), "SPEC.md")).toHaveProperty(
		"error",
	);
});

listingDenied(
	"resolveSpecPath fails closed when a parent directory exists but cannot be listed",
	() => {
		withProject((root) => {
			withUnlistableDirectory(root, () => {
				expect(resolveSpecPath(root, "unlistable/SPEC.md")).toHaveProperty("error");
				expect(resolveSpecPath(root, "unlistable/nested/SPEC.md")).toHaveProperty("error");
			});
			expect(ok(resolveSpecPath(root, "unlistable/SPEC.md"), root)).toBe("unlistable/SPEC.md");
		});
	},
);

test("SpecIndex walks in a stable order, so a duplicate id resolves the same everywhere", () => {
	withIndexRoot((root) => {
		for (const name of ["z-later", "a-earlier", "m-middle"]) {
			mkdirSync(join(root, name), { recursive: true });
			writeFileSync(
				join(root, name, "SPEC.md"),
				"---\nid: dup\ntype: module-design\ntitle: Dup\n---\n",
			);
		}
		const graph = new SpecIndex(root).graph();
		expect(graph.nodes.get("dup")?.path).toBe("a-earlier/SPEC.md");
		expect(graph.duplicateIds.get("dup")).toEqual([
			"a-earlier/SPEC.md",
			"m-middle/SPEC.md",
			"z-later/SPEC.md",
		]);
	});
});

test("SpecIndex walks a directory in its place among its sibling files, not before or after them", () => {
	withIndexRoot((root) => {
		const spec = "---\nid: dup\ntype: module-design\ntitle: Dup\n---\n";
		mkdirSync(join(root, "b-dir"), { recursive: true });
		writeFileSync(join(root, "a.md"), spec);
		writeFileSync(join(root, "b-dir", "SPEC.md"), spec);
		writeFileSync(join(root, "c.md"), spec);

		const graph = new SpecIndex(root).graph();
		expect(graph.duplicateIds.get("dup")).toEqual(["a.md", "b-dir/SPEC.md", "c.md"]);
		expect(graph.nodes.get("dup")?.path).toBe("a.md");
	});
});

test("the glob keeps the byte-exact ignored rule the resolver deliberately over-refuses", () => {
	withIndexRoot((root) => {
		mkdirSync(join(root, "NODE_MODULES"), { recursive: true });
		writeFileSync(
			join(root, "NODE_MODULES", "SPEC.md"),
			"---\nid: shouted\ntype: module-design\ntitle: S\n---\n",
		);

		expect(resolveSpecPath(root, "NODE_MODULES/SPEC.md")).toHaveProperty("error");
		expect(new SpecIndex(root).graph().nodes.has("shouted")).toBe(true);
	});
});

const walkOrder = (names: readonly string[]): string[] =>
	names
		.map((name) => toWalkEntry(name, false))
		.sort(compareWalkEntries)
		.map((entry) => entry.name);

test("the walk order compares NFC-normalized names, not raw code units", () => {
	expect(walkOrder(["A\u0308pfel", "Banana"])).toEqual(["Banana", "A\u0308pfel"]);
	expect(walkOrder(["Banana", "A\u0308pfel"])).toEqual(["Banana", "A\u0308pfel"]);
	expect(walkOrder(["\u00c4pfel", "Banana"])).toEqual(["Banana", "\u00c4pfel"]);
});

test("the walk order is total, so canonically equivalent names sort the same either way round", () => {
	const names = ["caf\u00e9", "cafe\u0301", "zebra", "\u00c4pfel", "A\u0308pfel", "apple"];
	expect(walkOrder(names)).toEqual(walkOrder([...names].reverse()));
	expect(walkOrder(["zebra", "caf\u00e9", "apple", "cafe\u0301"])).toEqual([
		"apple",
		"cafe\u0301",
		"caf\u00e9",
		"zebra",
	]);
});

spellingPreserving(
	"SpecIndex resolves a duplicate id the same way for canonically equivalent directory names",
	() => {
		withIndexRoot((root) => {
			const spellings = ["caf\u00e9", "cafe\u0301"];
			for (const name of spellings) {
				mkdirSync(join(root, name), { recursive: true });
				writeFileSync(
					join(root, name, "SPEC.md"),
					"---\nid: dup\ntype: module-design\ntitle: Dup\n---\n",
				);
			}
			const expected = ["cafe\u0301/SPEC.md", "caf\u00e9/SPEC.md"];
			const graph = new SpecIndex(root).graph();
			expect(graph.duplicateIds.get("dup")).toEqual(expected);
			expect(graph.nodes.get("dup")?.path).toBe(expected[0]);
		});
	},
);
