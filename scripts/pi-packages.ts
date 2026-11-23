import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PiPackage {
	dir: string;
	name: string;
	version: string;
	dependencies: Record<string, string>;
	piExtensions: string[];
}

export const repoRoot = resolve(import.meta.dir, "..");

export const BUN_ONLY = [
	/\bBun\./,
	/from\s+["']bun(?::|["'])/,
	/import\s*\(\s*["']bun:/,
	/import\.meta\.(?:dir|require)\b/,
];

export const EXTENSION_SDK_DIR = join(repoRoot, "packages", "extension-sdk");

function packagesIn(dirs: string[], withPrivate = false): PiPackage[] {
	const packages: PiPackage[] = [];
	for (const dir of dirs) {
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			name: string;
			version: string;
			private?: boolean;
			dependencies?: Record<string, string>;
			pi?: { extensions?: string[] };
		};
		if (manifest.private === true && !withPrivate) continue;
		packages.push({
			dir,
			name: manifest.name,
			version: manifest.version,
			dependencies: manifest.dependencies ?? {},
			piExtensions: manifest.pi?.extensions ?? [],
		});
	}
	return packages;
}

function childDirs(base: string): string[] {
	if (!existsSync(join(repoRoot, base))) return [];
	return readdirSync(join(repoRoot, base), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(repoRoot, base, entry.name));
}

export function publishablePiPackages(): PiPackage[] {
	return packagesIn(childDirs("pi-extensions"));
}

const extensionPackageDirs = () => [EXTENSION_SDK_DIR, ...childDirs("extension-examples")];

export function extensionPackages(): PiPackage[] {
	return packagesIn(extensionPackageDirs(), true);
}

export function publishableExtensionPackages(): PiPackage[] {
	return packagesIn(extensionPackageDirs());
}

export function publishablePackages(): PiPackage[] {
	return [...publishablePiPackages(), ...publishableExtensionPackages()];
}

export function dependenciesFirst(packages: PiPackage[]): PiPackage[] {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const ordered: PiPackage[] = [];
	const visiting = new Set<string>();
	const visit = (pkg: PiPackage): void => {
		if (ordered.includes(pkg)) return;
		if (visiting.has(pkg.name)) throw new Error(`dependency cycle through ${pkg.name}`);
		visiting.add(pkg.name);
		for (const dependency of Object.keys(pkg.dependencies)) {
			const target = byName.get(dependency);
			if (target) visit(target);
		}
		visiting.delete(pkg.name);
		ordered.push(pkg);
	};
	for (const pkg of packages) visit(pkg);
	return ordered;
}

export function run(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} (in ${cwd}) exited ${result.status}`);
	}
	return result.stdout;
}

export function tarballName(pkg: PiPackage): string {
	return `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
}

export function packPiPackage(pkg: PiPackage, destination: string): string {
	const tarball = join(destination, tarballName(pkg));
	run("bun", ["pm", "pack", "--filename", tarball], pkg.dir);
	if (!existsSync(tarball))
		throw new Error(`bun pm pack did not produce ${tarball} for ${pkg.name}`);
	return tarball;
}

export function publishedVersions(name: string): Set<string> {
	const result = spawnSync("npm", ["view", name, "versions", "--json"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		if (/E404|404 Not Found/.test(result.stderr)) return new Set();
		throw new Error(`npm view ${name} failed: ${result.stderr}`);
	}
	const parsed = JSON.parse(result.stdout) as string | string[];
	return new Set(Array.isArray(parsed) ? parsed : [parsed]);
}
