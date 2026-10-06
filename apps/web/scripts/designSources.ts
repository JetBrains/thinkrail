import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCES = ["apps/web/src", "packages/ui", "thinkrail-extensions/*/web"].map(
	(root) => new Glob(`${root}/**/*.{ts,tsx,css}`),
);

export function designSourceFiles(root = ROOT): string[] {
	return SOURCES.flatMap((source) => [...source.scanSync({ cwd: root, onlyFiles: true })])
		.filter(
			(path) =>
				!path.split(/[\\/]/).some((part) => ["generated", "node_modules", "dist"].includes(part)) &&
				!/\.test\.tsx?$/.test(path),
		)
		.sort()
		.map((path) => join(root, path));
}

export function designSourceLabel(path: string): string {
	return relative(ROOT, path)
		.split(sep)
		.join("/")
		.replace(/^apps\/web\/src\//, "");
}
