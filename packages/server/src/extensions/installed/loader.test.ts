import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { loadServerDescriptor, withForcedJitiTransform } from "./loader";
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
				createAgentSession: () => {},
				Type: {},
			}),
		).rejects.toThrow("did not resolve pi to the host's own copy");
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
});
