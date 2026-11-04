import { expect, test } from "bun:test";
import { shikiStub } from "./shikiStub";

const DIFFS =
	"/repo/node_modules/.bun/@pierre+diffs@1.6.4/node_modules/@pierre/diffs/dist/worker/worker.js";

function resolve(source: string, importer: string | undefined) {
	const { resolveId } = shikiStub();
	if (typeof resolveId !== "function") throw new Error("expected a resolveId function");
	return Reflect.apply(resolveId, {}, [source, importer, {}]);
}

test("Shiki imports from the diffs package resolve to the stub", () => {
	for (const source of ["shiki/core", "shiki/langs", "shiki/wasm"]) {
		expect(resolve(source, DIFFS)).toBe("\0shiki-stub");
	}
});

test("app code and other packages keep real resolution", () => {
	expect(resolve("shiki/core", "/repo/apps/web/src/lib/codeLanguages.ts")).toBeNull();
	expect(resolve("shiki", undefined)).toBeNull();
	expect(resolve("react", DIFFS)).toBeNull();
	expect(resolve("shikimori", DIFFS)).toBeNull();
});

test("the stub throws when something calls into it", async () => {
	const { load } = shikiStub();
	if (typeof load !== "function") throw new Error("expected a load function");
	const source = String(Reflect.apply(load, {}, ["\0shiki-stub"]));
	const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
	expect(() => module.createHighlighterCore()).toThrow("Shiki is not part of this build");
});
