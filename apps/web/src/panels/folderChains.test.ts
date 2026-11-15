import { expect, test } from "bun:test";
import {
	type FolderChainNode,
	folderRevealMissed,
	folderRevealPaths,
	listingMissesReveal,
	resolveFolderChain,
} from "./folderChains";

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

test("revealing any folder a compact row stands for expands the whole row", () => {
	const chain = { label: "assets/icons", path: "assets/icons", paths: ["assets", "assets/icons"] };
	expect(folderRevealPaths(chain, "assets")).toEqual(["assets", "assets/icons"]);
	expect(folderRevealPaths(chain, "assets/icons")).toEqual(["assets", "assets/icons"]);
	expect(folderRevealPaths(chain, "assets/icons/svg")).toBeNull();
	expect(folderRevealPaths(chain, "asset")).toBeNull();
	expect(folderRevealPaths(chain, null)).toBeNull();
});

test("a listing misses a reveal target that is neither one of its entries nor inside one", () => {
	const listing = [dir("src"), file("README.md")];
	expect(listingMissesReveal(listing, "src")).toBe(false);
	expect(listingMissesReveal(listing, "src/auth/login.ts")).toBe(false);
	expect(listingMissesReveal(listing, "README.md")).toBe(false);
	expect(listingMissesReveal(listing, "docs")).toBe(true);
	expect(listingMissesReveal(listing, "srcx/a.ts")).toBe(true);
	expect(listingMissesReveal([], "src")).toBe(true);
	expect(listingMissesReveal(listing, null)).toBe(false);
});

test("a loaded folder row gives up a reveal target inside it that its listing cannot reach", () => {
	const chain = {
		label: "assets/icons",
		path: "assets/icons",
		paths: ["assets", "assets/icons"],
		children: [file("logo.svg", "assets/icons/logo.svg"), dir("svg", "assets/icons/svg")],
	};
	expect(folderRevealMissed(chain, "assets/icons/logo.svg")).toBe(false);
	expect(folderRevealMissed(chain, "assets/icons/svg/a.svg")).toBe(false);
	expect(folderRevealMissed(chain, "assets")).toBe(false);
	expect(folderRevealMissed(chain, "assets/icons")).toBe(false);
	expect(folderRevealMissed(chain, "assets/icons/gone.svg")).toBe(true);
	expect(folderRevealMissed(chain, "assets/fonts/a.woff2")).toBe(true);
	expect(folderRevealMissed(chain, "docs/a.md")).toBe(false);
	expect(folderRevealMissed(chain, null)).toBe(false);
});
