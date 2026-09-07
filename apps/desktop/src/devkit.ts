import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BunPlugin } from "bun";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function electrobunDevkitPlugin(devkitDir: string): BunPlugin {
	const manifestPath = join(devkitDir, "package.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (cause) {
		throw new Error(`Electrobun SDK unavailable at ${devkitDir}; run electrobun prepare first`, {
			cause,
		});
	}
	if (!isRecord(manifest) || !isRecord(manifest.exports)) {
		throw new Error(`Electrobun SDK export map is invalid: ${manifestPath}`);
	}
	const apiRoot = resolve(devkitDir, "api");
	const aliases = new Map<string, string>();
	for (const [subpath, target] of Object.entries(manifest.exports)) {
		if (
			(subpath !== "." && !subpath.startsWith("./")) ||
			subpath.includes("*") ||
			typeof target !== "string" ||
			!target.startsWith("./api/")
		) {
			throw new Error(`Invalid Electrobun SDK export: ${subpath}`);
		}
		const path = resolve(devkitDir, target);
		const child = relative(apiRoot, path);
		if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
			throw new Error(`Electrobun SDK export escapes its API directory: ${subpath}`);
		}
		aliases.set(subpath === "." ? "electrobun" : `electrobun/${subpath.slice(2)}`, path);
	}
	return {
		name: "electrobun-devkit",
		setup(build) {
			build.onResolve({ filter: /^electrobun(?:\/|$)/ }, ({ path: specifier }) => {
				const path = aliases.get(specifier);
				if (!path) throw new Error(`Electrobun SDK does not export ${specifier}`);
				return { path };
			});
		},
	};
}
