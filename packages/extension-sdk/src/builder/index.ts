import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SharedModulesManifest } from "../shared";
import { bundleWebHalf } from "./bundle";
import { ExtensionBuildError } from "./errors";
import { displayPath, readExtensionPackage } from "./manifest";
import { buildStylesheet, PREFIX_PATTERN } from "./styles";

export { ExtensionBuildError } from "./errors";

export const DEFAULT_ENTRIES = ["web/index.tsx", "web/index.ts"];

export interface BuildOptions {
	root: string;
	prefix?: string | undefined;
	entry?: string | undefined;
	css?: string | undefined;
	minify?: boolean | undefined;
	assetsDir: URL;
}

export interface BuildOutput {
	name: string;
	files: { path: string; bytes: number }[];
	warnings: string[];
}

function resolveEntry(root: string, entry: string | undefined): string {
	if (entry !== undefined) {
		const path = resolve(root, entry);
		if (!existsSync(path)) throw new ExtensionBuildError(`--entry ${entry} does not exist.`);
		return path;
	}
	for (const candidate of DEFAULT_ENTRIES) {
		const path = resolve(root, candidate);
		if (existsSync(path)) return path;
	}
	throw new ExtensionBuildError(
		`the manifest declares "web" but no web entry was found (looked for ${DEFAULT_ENTRIES.join(", ")}); pass --entry <file>.`,
	);
}

export async function buildExtension(options: BuildOptions): Promise<BuildOutput> {
	const root = realpathSync(resolve(options.root));
	const pkg = readExtensionPackage(root);
	const { manifest } = pkg;
	const warnings = [...pkg.warnings];
	const files: string[] = [];
	if (manifest.web === undefined) {
		for (const flag of ["prefix", "entry", "css"] as const) {
			if (options[flag] !== undefined)
				warnings.push(`--${flag} is ignored: the manifest declares no "web".`);
		}
		return { name: pkg.name, files: [], warnings };
	}
	if (manifest.styles !== undefined && options.prefix === undefined) {
		throw new ExtensionBuildError(
			'--prefix is required because the manifest declares "styles": choose lowercase letters unique to this extension (for example --prefix palette) and write its utilities as palette:p-8.',
		);
	}
	if (options.prefix !== undefined && !PREFIX_PATTERN.test(options.prefix)) {
		throw new ExtensionBuildError(
			`--prefix "${options.prefix}" is invalid: a Tailwind prefix is lowercase letters a–z only.`,
		);
	}
	if (manifest.styles === undefined && options.prefix !== undefined) {
		warnings.push('--prefix is ignored: the manifest declares no "styles".');
	}
	const css = options.css === undefined ? undefined : resolve(root, options.css);
	if (css !== undefined) {
		if (manifest.styles === undefined) {
			throw new ExtensionBuildError('--css needs a "styles" path in the manifest to write to.');
		}
		if (!existsSync(css) || !statSync(css).isFile()) {
			throw new ExtensionBuildError(`--css ${options.css} does not exist.`);
		}
	}
	const entry = resolveEntry(root, options.entry);
	const minify = options.minify ?? true;
	const sharedModules = JSON.parse(
		readFileSync(new URL("shared-modules.json", options.assetsDir), "utf8"),
	) as SharedModulesManifest;

	const webFile = resolve(root, manifest.web);
	await rm(webFile, { force: true });
	const bundle = await bundleWebHalf({
		root,
		entry,
		outFile: webFile,
		minify,
		manifest: sharedModules,
	});
	warnings.push(...bundle.warnings);
	files.push(webFile);

	if (manifest.styles !== undefined && options.prefix !== undefined) {
		const stylesFile = resolve(root, manifest.styles);
		await rm(stylesFile, { force: true });
		await buildStylesheet({
			root,
			sourceDir: dirname(entry),
			prefix: options.prefix,
			css,
			outFile: stylesFile,
			minify,
			assetsDir: options.assetsDir,
		});
		files.push(stylesFile);
	}
	return {
		name: pkg.name,
		files: files.map((path) => ({ path: displayPath(root, path), bytes: statSync(path).size })),
		warnings,
	};
}
