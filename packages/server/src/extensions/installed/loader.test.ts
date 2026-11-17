import { describe, expect, it } from "bun:test";
import { join } from "node:path";
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
			seen.push(`a:${process.env.JITI_TRY_NATIVE}:${process.env.JITI_REBUILD_FS_CACHE}`);
		});
		const fast = withForcedJitiTransform(async () => {
			seen.push(`b:${process.env.JITI_TRY_NATIVE}`);
		});
		await Promise.all([slow, fast]);
		expect(seen).toEqual(["a:false:1", "b:false"]);
		expect(process.env.JITI_TRY_NATIVE).toBe("keep");
		if (prior === undefined) delete process.env.JITI_TRY_NATIVE;
		else process.env.JITI_TRY_NATIVE = prior;
	});
});
