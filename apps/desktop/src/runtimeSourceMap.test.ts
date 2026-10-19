import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chunkIdFor, injectChunkId, type SourceMapJson } from "./runtimeSourceMap";

const dir = mkdtempSync(join(tmpdir(), "thinkrail-runtime-map-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("chunk ids are deterministic UUIDs of the bundle content", () => {
	expect(chunkIdFor("a")).toBe(chunkIdFor("a"));
	expect(chunkIdFor("a")).not.toBe(chunkIdFor("b"));
	expect(chunkIdFor("a")).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
});

test("injection keeps the @bun pragma first, registers the chunk, and keeps the map aligned", async () => {
	writeFileSync(
		join(dir, "entry.ts"),
		[
			"export function a(): number {",
			"\treturn 1;",
			"}",
			"export function explode(): never {",
			"\tconst x = a();",
			'\tthrow new Error("boom" + x);',
			"}",
			"",
		].join("\n"),
	);
	const built = await Bun.build({
		entrypoints: [join(dir, "entry.ts")],
		target: "bun",
		sourcemap: "external",
		outdir: join(dir, "out"),
		naming: "server-runtime.ts",
	});
	expect(built.success).toBe(true);
	const file = join(dir, "out", "server-runtime.ts");
	const code = readFileSync(file, "utf8");
	const map = JSON.parse(readFileSync(`${file}.map`, "utf8")) as SourceMapJson;
	expect(code.startsWith("// @bun")).toBe(true);

	const injected = injectChunkId(code, map);
	expect(injected.code.split("\n")[0]).toBe(code.split("\n")[0]);
	expect(injected.code).toContain(`//# chunkId=${injected.chunkId}`);
	expect(injected.map.chunk_id).toBe(injected.chunkId);

	const frameOf = async (name: string, source: string, sourceMap: SourceMapJson) => {
		const path = join(dir, "out", name);
		writeFileSync(path, `${source}//# sourceMappingURL=${name}.map\n`);
		writeFileSync(`${path}.map`, JSON.stringify(sourceMap));
		const loaded = (await import(pathToFileURL(path).href)) as { explode(): never };
		try {
			loaded.explode();
		} catch (error) {
			return String((error as Error).stack).split("\n")[1];
		}
	};
	const original = await frameOf("original.ts", code, map);
	const registry = globalThis as { _posthogChunkIds?: Record<string, string> };
	const shifted = await frameOf("server-runtime.ts", injected.code, injected.map);
	expect(original).toContain("entry.ts:6:");
	expect(shifted).toBe(original);
	const [stack, id] = Object.entries(registry._posthogChunkIds ?? {}).at(-1) ?? [];
	expect(id).toBe(injected.chunkId);
	expect(stack).toContain("server-runtime.ts");
	delete registry._posthogChunkIds;
});
