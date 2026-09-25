import { expect, test } from "bun:test";
import { ownSourcesMap } from "./sourceMap";

const MAP = {
	version: 3,
	sources: ["node_modules/dep/a.js", "view.tsx", "node_modules/dep/b.js"],
	sourcesContent: ["dep a", "own view", "dep b"],
	names: ["x"],
	mappings: "AAAA,KCAA,KCCAA;AFAA,GCGAC",
};

test("keeps only own sources and remaps their segments", () => {
	const out = JSON.parse(ownSourcesMap(JSON.stringify(MAP), (s) => !s.includes("node_modules/")));
	expect(out.sources).toEqual(["view.tsx"]);
	expect(out.sourcesContent).toEqual(["own view"]);
	expect(out.names).toEqual(["x"]);
	expect(out.mappings).toBe("KAAA,K;GAIAC");
});

test("rejects input that is not a source map", () => {
	expect(() => ownSourcesMap("{}", () => true)).toThrow("not a source map");
});
