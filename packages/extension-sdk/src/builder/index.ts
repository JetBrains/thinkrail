import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SharedModulesManifest } from "../shared";
import { bundleWebHalf } from "./bundle";
import { ExtensionBuildError } from "./errors";
import { displayPath, readExtensionPackage } from "./manifest";
import { checkOutputPaths, type LabelledPath, tempBeside } from "./paths";
import { buildStylesheet, PREFIX_PATTERN } from "./styles";

export { ExtensionBuildError, ExtensionUsageError } from "./errors";

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
	const staging = (path: string) => ({ path, temp: tempBeside(path) });
	const web = staging(resolve(root, manifest.web));
	const styles =
		manifest.styles !== undefined && options.prefix !== undefined
			? { ...staging(resolve(root, manifest.styles)), prefix: options.prefix }
			: undefined;
	const inputs: LabelledPath[] = [
		{ label: options.entry === undefined ? "the web entry" : "--entry", path: entry },
		{ label: "package.json", path: join(root, "package.json") },
	];
	if (css !== undefined) inputs.push({ label: "--css", path: css });
	if (manifest.server !== undefined)
		inputs.push({ label: 'the "server" file', path: resolve(root, manifest.server) });
	const outputs = [{ label: '"web"', ...web }];
	if (styles !== undefined) outputs.push({ label: '"styles"', ...styles });
	checkOutputPaths(root, inputs, outputs);

	const minify = options.minify ?? true;
	const sharedModules = JSON.parse(
		readFileSync(new URL("shared-modules.json", options.assetsDir), "utf8"),
	) as SharedModulesManifest;

	const staged = styles === undefined ? [web] : [web, styles];
	try {
		const bundle = await bundleWebHalf({
			root,
			entry,
			outFile: web.temp,
			minify,
			manifest: sharedModules,
		});
		warnings.push(...bundle.warnings);
		if (styles !== undefined) {
			await buildStylesheet({
				root,
				sourceDir: dirname(entry),
				prefix: styles.prefix,
				css,
				outFile: styles.temp,
				minify,
				assetsDir: options.assetsDir,
			});
		}
		for (const { path, temp } of staged) {
			renameSync(temp, path);
			files.push(path);
		}
	} finally {
		for (const { temp } of staged) rmSync(temp, { force: true });
	}
	return {
		name: pkg.name,
		files: files.map((path) => ({ path: displayPath(root, path), bytes: statSync(path).size })),
		warnings,
	};
}
