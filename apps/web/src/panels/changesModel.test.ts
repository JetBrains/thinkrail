import { expect, test } from "bun:test";
import type { GitFileChange } from "@thinkrail/contracts";
import { buildChangesTree, type ChangeTreeDir } from "./changesModel";

function change(path: string, over: Partial<GitFileChange> = {}): GitFileChange {
	return { path, status: "modified", added: 1, removed: 0, ...over };
}

test("buildChangesTree nests files under their folders", () => {
	const tree = buildChangesTree([
		change("apps/web/a.ts"),
		change("apps/web/b.ts"),
		change("packages/server/c.ts"),
	]);
	expect(tree.map((n) => n.name)).toEqual(["apps", "packages"]);
	const apps = tree[0] as ChangeTreeDir;
	const web = apps.children[0] as ChangeTreeDir;
	expect(web.name).toBe("web");
	expect(web.children.map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
});

test("buildChangesTree aggregates +/- counts up into folders", () => {
	const tree = buildChangesTree([
		change("src/x.ts", { added: 3, removed: 1 }),
		change("src/deep/y.ts", { added: 5, removed: 2 }),
	]);
	const src = tree[0] as ChangeTreeDir;
	expect(src.added).toBe(8);
	expect(src.removed).toBe(3);
	const deep = src.children.find((n) => n.name === "deep") as ChangeTreeDir;
	expect(deep.added).toBe(5);
	expect(deep.removed).toBe(2);
});

test("buildChangesTree sorts directories before files, each alphabetically", () => {
	const tree = buildChangesTree([change("z.ts"), change("a.ts"), change("dir/inner.ts")]);
	expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(["dir:dir", "file:a.ts", "file:z.ts"]);
});

test("buildChangesTree treats missing counts as zero", () => {
	const tree = buildChangesTree([{ path: "bin.png", status: "modified" }]);
	expect(tree[0]).toMatchObject({ kind: "file", name: "bin.png", added: 0, removed: 0 });
});
