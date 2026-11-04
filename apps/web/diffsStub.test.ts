import { expect, test } from "bun:test";
import { diffsStub } from "./diffsStub";

const DIFFS =
	"/repo/node_modules/.bun/@pierre+diffs@1.6.4/node_modules/@pierre/diffs/dist/worker/worker.js";

function resolve(source: string, importer: string | undefined) {
	const { resolveId } = diffsStub();
	if (typeof resolveId !== "function") throw new Error("expected a resolveId function");
	return Reflect.apply(resolveId, {}, [source, importer, {}]);
}

test("Shiki imports from the diffs package resolve to the stub", () => {
	for (const source of ["shiki/core", "shiki/langs", "shiki/wasm"]) {
		expect(resolve(source, DIFFS)).toBe("\0diffs-stub");
	}
});

test("theme catalogs imported by the diffs package resolve to the stub", () => {
	for (const source of [
		"@pierre/highlights/themes",
		"@pierre/highlights/themes/loader",
		"@pierre/theming/themes",
	]) {
		expect(resolve(source, DIFFS)).toBe("\0diffs-stub");
	}
});

test("the highlighter and app imports of a theme file keep real resolution", () => {
	expect(resolve("@pierre/highlights", DIFFS)).toBeNull();
	expect(resolve("@pierre/theming", DIFFS)).toBeNull();
	expect(resolve("@pierre/highlights/themes/nord", "/repo/apps/web/src/themes/x.ts")).toBeNull();
});

test("app code and other packages keep real resolution", () => {
	expect(resolve("shiki/core", "/repo/apps/web/src/lib/codeLanguages.ts")).toBeNull();
	expect(resolve("shiki", undefined)).toBeNull();
	expect(resolve("react", DIFFS)).toBeNull();
	expect(resolve("shikimori", DIFFS)).toBeNull();
});

test("the stub throws when something calls into it", async () => {
	const { load } = diffsStub();
	if (typeof load !== "function") throw new Error("expected a load function");
	const source = String(Reflect.apply(load, {}, ["\0diffs-stub"]));
	const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
	expect(() => module.createHighlighterCore()).toThrow("Not part of this build");
});
