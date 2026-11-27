import { expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { piExtensionInstaller, pruneHostOwnedDependencies } from "./installer";
import { tempDir } from "./testFixtures";

it("keeps pi and typebox out of every node_modules of an install", () => {
	const root = tempDir();
	const kept = join(root, "npm", "node_modules", "left-pad");
	const paths = [
		join(root, "npm", "node_modules", "@earendil-works", "pi-coding-agent"),
		join(root, "npm", "node_modules", "typebox"),
		join(kept, "node_modules", "@earendil-works", "pi-ai"),
		join(kept, "node_modules", "typebox"),
	];
	for (const path of [...paths, kept, join(root, "npm", "node_modules", "@earendil-other", "x")]) {
		mkdirSync(path, { recursive: true });
	}
	pruneHostOwnedDependencies(root);
	for (const path of paths) expect(existsSync(path)).toBe(false);
	expect(existsSync(kept)).toBe(true);
	expect(existsSync(join(root, "npm", "node_modules", "@earendil-other", "x"))).toBe(true);
});

it("fetches with the user's pi npm command", async () => {
	const missing = join(tempDir(), "no-such-npm");
	await expect(
		piExtensionInstaller(() => [missing]).install("npm:left-pad", join(tempDir(), "install")),
	).rejects.toThrow(missing);
});

it("hands npm's own output back in the error when asked to capture it", async () => {
	const npm = join(tempDir(), "fake-npm.mjs");
	writeFileSync(npm, 'process.stderr.write("npm error code E404\\n"); process.exit(1);');
	await expect(
		piExtensionInstaller(() => [process.execPath, npm]).install(
			"npm:nope-pkg",
			join(tempDir(), "install"),
			"capture",
		),
	).rejects.toThrow("npm error code E404");
});
