import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_CONTEXT_DIR } from "./paths";

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

export function seedArtifactsDir(root: string): string {
	let dir = root;
	for (const part of WORKSPACE_CONTEXT_DIR.split("/")) {
		dir = join(dir, part);
		if (!lstatSync(dir, { throwIfNoEntry: false })) {
			try {
				mkdirSync(dir);
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
			}
		}
		if (!lstatSync(dir).isDirectory())
			throw new Error(`Refusing to seed the scratch dir: not a real directory: ${dir}`);
	}
	const gitignore = join(dir, ".gitignore");
	if (lstatSync(gitignore, { throwIfNoEntry: false })) return dir;
	try {
		writeFileSync(gitignore, "*\n", { flag: "wx" });
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	return dir;
}
