import { expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pruneHostOwnedDependencies } from "./installer";
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
