import { describe, it, expect } from "vitest";
import { buildDocTree } from "../treeUtils";
import type { DocumentEntry } from "@/types/spec";

/** Helper to create a DocumentEntry */
function doc(path: string, title = path): DocumentEntry {
  return { path, title };
}

describe("buildDocTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildDocTree([])).toEqual([]);
  });

  it("returns a single root-level file at depth 0", () => {
    const result = buildDocTree([doc("README.md")]);
    expect(result).toEqual([
      { path: "README.md", name: "README.md", isDir: false, depth: 0 },
    ]);
  });

  it("absorbs single-dir-from-root into virtual root (no dir node)", () => {
    // When all files share one common directory, the dir is absorbed
    // into the virtual root — files appear at depth 0 directly
    const result = buildDocTree([doc("docs/guide.md")]);
    expect(result).toEqual([
      { path: "docs/guide.md", name: "guide.md", isDir: false, depth: 0 },
    ]);
  });

  it("absorbs deeply nested single-child chain into virtual root", () => {
    // a/b/c are all single-child intermediates — the entire chain
    // collapses into the root, leaving just the file at depth 0
    const result = buildDocTree([doc("a/b/c/file.md")]);
    expect(result).toEqual([
      { path: "a/b/c/file.md", name: "file.md", isDir: false, depth: 0 },
    ]);
  });

  it("absorbs single shared dir when multiple files in same directory", () => {
    const result = buildDocTree([doc("src/a.md"), doc("src/b.md")]);
    // src/ is the only child of root → absorbed, files at depth 0
    expect(result).toEqual([
      { path: "src/a.md", name: "a.md", isDir: false, depth: 0 },
      { path: "src/b.md", name: "b.md", isDir: false, depth: 0 },
    ]);
  });

  it("emits dir nodes when a branching point exists below absorbed root", () => {
    // pkg/ is absorbed into root, but pkg/ has both a subdir and files,
    // so the subdir "sub" appears as a dir node at depth 0
    const result = buildDocTree([
      doc("pkg/README.md"),
      doc("pkg/sub/detail.md"),
    ]);
    expect(result).toEqual([
      { path: "pkg/sub", name: "sub", isDir: true, depth: 0 },
      { path: "pkg/sub/detail.md", name: "detail.md", isDir: false, depth: 1 },
      { path: "pkg/README.md", name: "README.md", isDir: false, depth: 0 },
    ]);
  });

  it("sorts directories before files, both alphabetically", () => {
    const result = buildDocTree([
      doc("z-file.md"),
      doc("a-file.md"),
      doc("m-dir/doc.md"),
      doc("b-dir/doc.md"),
    ]);
    // Root level: dirs first (b-dir, m-dir), then files (a-file, z-file)
    const rootNames = result.filter((n) => n.depth === 0).map((n) => n.name);
    expect(rootNames).toEqual(["b-dir", "m-dir", "a-file.md", "z-file.md"]);
  });

  it("sorts files alphabetically within a shared directory", () => {
    const result = buildDocTree([
      doc("docs/c.md"),
      doc("docs/a.md"),
      doc("docs/b.md"),
    ]);
    // docs/ absorbed into root — files at depth 0, sorted
    const names = result.map((n) => n.name);
    expect(names).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("collapses common prefix and shows branch dirs without prefix", () => {
    // a/b is the common chain → absorbed into root
    // c/ and d/ are branch dirs at the divergence point
    const result = buildDocTree([
      doc("a/b/c/file1.md"),
      doc("a/b/d/file2.md"),
    ]);
    expect(result).toEqual([
      { path: "a/b/c", name: "c", isDir: true, depth: 0 },
      { path: "a/b/c/file1.md", name: "file1.md", isDir: false, depth: 1 },
      { path: "a/b/d", name: "d", isDir: true, depth: 0 },
      { path: "a/b/d/file2.md", name: "file2.md", isDir: false, depth: 1 },
    ]);
  });

  it("mixes root-level files with nested directories", () => {
    const result = buildDocTree([
      doc("README.md"),
      doc("CHANGELOG.md"),
      doc("docs/guide.md"),
    ]);
    // Root has both files and a subdir → NOT collapsed
    // Dir first, then files, all alphabetical
    expect(result[0]).toMatchObject({ name: "docs", isDir: true, depth: 0 });
    const rootFiles = result
      .filter((n) => !n.isDir && n.depth === 0)
      .map((n) => n.name);
    expect(rootFiles).toEqual(["CHANGELOG.md", "README.md"]);
  });

  it("preserves full path on file nodes even when dirs are absorbed", () => {
    const result = buildDocTree([doc("a/b/c/file.md")]);
    expect(result[0].path).toBe("a/b/c/file.md");
  });

  it("dir node path reflects actual filesystem path (for collapse toggling)", () => {
    const result = buildDocTree([
      doc("a/b/c/file1.md"),
      doc("a/b/d/file2.md"),
    ]);
    // The dir nodes should have paths usable for collapse state
    const dirPaths = result.filter((n) => n.isDir).map((n) => n.path);
    expect(dirPaths).toEqual(["a/b/c", "a/b/d"]);
  });

  it("collapses intermediate dir that has single subdir but no files", () => {
    // parent/ has only one child "child/" → collapsed to "parent/child"
    const result = buildDocTree([
      doc("README.md"),
      doc("parent/child/file.md"),
    ]);
    // Root has file + dir → not absorbed
    const dirNode = result.find((n) => n.isDir);
    expect(dirNode).toMatchObject({
      name: "parent/child",
      path: "parent/child",
      isDir: true,
      depth: 0,
    });
  });
});
