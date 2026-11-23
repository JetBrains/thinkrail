import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { loadServerDescriptor, withForcedJitiTransform } from "./loader";

const SINK = Symbol.for("thinkrail.extensionDescriptors");
const sinkSize = () =>
	(globalThis as Record<symbol, Map<string, unknown> | undefined>)[SINK]?.size ?? 0;

function writeEntry(root: string, body: string): string {
	const entry = join(root, "pkg", "server.ts");
	mkdirSync(dirname(entry), { recursive: true });
	writeFileSync(
		join(root, "pkg", "package.json"),
		JSON.stringify({ name: "slow", type: "module" }),
	);
	writeFileSync(entry, body);
	return entry;
}

import { tempDir, writeExtension } from "./testFixtures";

describe("loadServerDescriptor", () => {
	it("hands back the descriptor, imported against the host's own pi, and leaves the package untouched", async () => {
		const root = tempDir();
		const folder = writeExtension(join(root, "pkg"), { name: "loader-fixture" });
		const before = [...new Bun.Glob("**/*").scanSync(folder)].sort();
		const descriptor = await loadServerDescriptor(
			join(folder, "server", "index.ts"),
			join(root, "host"),
		);
		expect(descriptor.name).toBe("loader-fixture");
		expect(descriptor.extensions).toHaveLength(1);
		expect([...new Bun.Glob("**/*").scanSync(folder)].sort()).toEqual(before);
		expect([...new Bun.Glob("shims/*").scanSync(join(root, "host"))]).toEqual([]);
	});

	it("refuses a descriptor when the loader's pi is not the host's", async () => {
		const root = tempDir();
		const folder = writeExtension(join(root, "pkg"), { name: "guarded" });
		await expect(
			loadServerDescriptor(join(folder, "server", "index.ts"), join(root, "host"), {
				host: { createAgentSession: () => {}, Type: {} },
			}),
		).rejects.toThrow("did not resolve pi to the host's own copy");
	});

	it("fails a top level that never settles within the timeout and frees the shared chain", async () => {
		const root = tempDir();
		const entry = writeEntry(
			root,
			"await new Promise(() => {});\nexport default { name: 'slow', extensions: [] };\n",
		);
		const prior = process.env.JITI_TRY_NATIVE;
		const started = Date.now();
		await expect(
			loadServerDescriptor(entry, join(root, "host"), { timeoutMs: 150 }),
		).rejects.toThrow("did not finish loading within 0.15 s");
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(process.env.JITI_TRY_NATIVE).toBe(prior);
		expect(await withForcedJitiTransform(async () => "next")).toBe("next");
		expect([...new Bun.Glob("shims/*").scanSync(join(root, "host"))]).toEqual([]);
	});

	it("drops a load that settles after its timeout: nothing is kept and the env is not touched again", async () => {
		const root = tempDir();
		const entry = writeEntry(
			root,
			"await new Promise((resolve) => setTimeout(resolve, 300));\nexport default { name: 'slow', extensions: [] };\n",
		);
		const before = sinkSize();
		await expect(
			loadServerDescriptor(entry, join(root, "host"), { timeoutMs: 100 }),
		).rejects.toThrow("did not finish loading");
		const during = await withForcedJitiTransform(async () => {
			await Bun.sleep(400);
			return process.env.JITI_TRY_NATIVE;
		});
		expect(during).toBe("false");
		await Bun.sleep(50);
		expect(sinkSize()).toBe(before);
	});

	it("drops a load that fails after its timeout without an unhandled rejection", async () => {
		const root = tempDir();
		const entry = writeEntry(
			root,
			"await new Promise((resolve) => setTimeout(resolve, 200));\nthrow new Error('late');\n",
		);
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			await expect(
				loadServerDescriptor(entry, join(root, "host"), { timeoutMs: 50 }),
			).rejects.toThrow("did not finish loading");
			await Bun.sleep(400);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	const esmEntry = (version: string, ext: string) => `import { Type } from "typebox";
import helper from "./helper.${ext}";
import dep from "dep";
await Promise.resolve();
export default { name: "kinds", extensions: [() => "${version}"], probe: { Type, helper, dep } };
`;
	const cjsEntry = (version: string, ext: string) => `const helper = require("./helper.${ext}");
const dep = require("dep");
module.exports = { name: "kinds", extensions: [() => "${version}"], probe: { helper, dep } };
`;
	const ESM_HELPER = "export default 'helper';\n";
	const CJS_HELPER = "module.exports = 'helper';\n";

	it.each([
		["ts", "module", esmEntry, ESM_HELPER],
		["mts", "module", esmEntry, ESM_HELPER],
		["cts", "commonjs", esmEntry, ESM_HELPER],
		["js", "module", esmEntry, ESM_HELPER],
		["mjs", "commonjs", esmEntry, ESM_HELPER],
		["js", "commonjs", cjsEntry, CJS_HELPER],
		["cjs", "module", cjsEntry, CJS_HELPER],
	] as const)(
		"re-evaluates an edited .%s entry of a %s package on the same path",
		async (ext, type, entryOf, helper) => {
			const root = tempDir();
			const files: Record<string, string> = {
				"package.json": JSON.stringify({ name: "kinds", type }),
				[`server/helper.${ext}`]: helper,
				"node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
				"node_modules/dep/index.js": "module.exports = 'dep';\n",
				"node_modules/typebox/package.json": JSON.stringify({ name: "typebox", main: "index.js" }),
				"node_modules/typebox/index.js": "exports.Type = { authorCopy: true };\n",
			};
			for (const [file, body] of Object.entries(files)) {
				mkdirSync(dirname(join(root, "pkg", file)), { recursive: true });
				writeFileSync(join(root, "pkg", file), body);
			}
			const entry = join(root, "pkg", "server", `index.${ext}`);
			const load = async (version: string) => {
				writeFileSync(entry, entryOf(version, ext));
				const descriptor = await loadServerDescriptor(entry, join(root, "host"));
				const [factory] = descriptor.extensions as unknown as (() => string)[];
				return { ran: factory?.(), probe: (descriptor as unknown as { probe: object }).probe };
			};
			expect((await load("v1")).ran).toBe("v1");
			const second = await load("v2");
			expect(second.ran).toBe("v2");
			expect(second.probe).toMatchObject({ helper: "helper", dep: "dep" });
			if (entryOf === esmEntry) expect(second.probe).toMatchObject({ Type });
		},
	);

	it.each([
		["queries", "queries: () => ({})"],
		["apiVersion", "apiVersion: 1"],
		["supersedesPackages", 'supersedesPackages: ["@thinkrail/pi-session-insights"]'],
	])("refuses a descriptor that declares the built-in-only %s", async (key, field) => {
		const root = tempDir();
		const entry = writeEntry(root, `export default { name: "hooks", extensions: [], ${field} };\n`);
		await expect(loadServerDescriptor(entry, join(root, "host"))).rejects.toThrow(
			`"${key}" is not part of extension API 1.0`,
		);
	});

	it("reports a missing entry as a load error", async () => {
		const root = tempDir();
		await expect(
			loadServerDescriptor(join(root, "missing.ts"), join(root, "host")),
		).rejects.toThrow();
	});
});

describe("withForcedJitiTransform", () => {
	it("forces pi's transform for the task and restores the env, one task at a time", async () => {
		const prior = process.env.JITI_TRY_NATIVE;
		process.env.JITI_TRY_NATIVE = "keep";
		const seen: string[] = [];
		const slow = withForcedJitiTransform(async () => {
			await Bun.sleep(5);
			seen.push(
				`a:${process.env.JITI_TRY_NATIVE}:${process.env.JITI_REBUILD_FS_CACHE}:${process.env.JITI_FS_CACHE}`,
			);
		});
		const fast = withForcedJitiTransform(async () => {
			seen.push(`b:${process.env.JITI_TRY_NATIVE}`);
		});
		await Promise.all([slow, fast]);
		expect(seen).toEqual(["a:false:1:false", "b:false"]);
		expect(process.env.JITI_TRY_NATIVE).toBe("keep");
		if (prior === undefined) delete process.env.JITI_TRY_NATIVE;
		else process.env.JITI_TRY_NATIVE = prior;
	});

	it("a task past its timeout rejects, restores the env and lets the next task run", async () => {
		const prior = process.env.JITI_TRY_NATIVE;
		const hung = withForcedJitiTransform(() => new Promise(() => {}), 50);
		const next = withForcedJitiTransform(async () => process.env.JITI_TRY_NATIVE);
		await expect(hung).rejects.toThrow("did not finish loading within 0.05 s");
		expect(await next).toBe("false");
		expect(process.env.JITI_TRY_NATIVE).toBe(prior);
	});
});
