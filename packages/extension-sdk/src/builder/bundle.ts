import { isBuiltin } from "node:module";
import { isAbsolute, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { build, type Plugin } from "rolldown";
import { parseSync } from "rolldown/utils";
import {
	SDK_PACKAGE,
	SHARED_SPECIFIERS,
	type SharedModulesManifest,
	type SharedSpecifier,
} from "../shared";
import { ExtensionBuildError } from "./errors";
import {
	hostModuleSource,
	hostRuntimeSource,
	isSharedSpecifier,
	jsxDevRuntimeSource,
} from "./hostModules";

const HOST = "\0thinkrail-host:";
const RUNTIME = `${HOST}runtime`;
const JSX_DEV = `${HOST}react/jsx-dev-runtime`;

const PRIVATE = /^@thinkrail\/(?:ui|extension-api|resource-renderers)(?:\/|$)/;

function sdkCounterpart(specifier: string): string | undefined {
	const ui = /^@thinkrail\/ui\/(.+)$/.exec(specifier);
	if (ui) return `${SDK_PACKAGE}/ui/${ui[1]}`;
	if (/^@thinkrail\/extension-api(?:\/web)?$/.test(specifier)) return `${SDK_PACKAGE}/web`;
	if (specifier === "@thinkrail/extension-api/server") return `${SDK_PACKAGE}/server`;
	if (specifier === "@thinkrail/resource-renderers") return `${SDK_PACKAGE}/resources`;
	return undefined;
}

function sharedSdkModules(prefix: string): string {
	return SHARED_SPECIFIERS.filter((name) => name.startsWith(prefix)).join(", ");
}

function sdkRejection(specifier: string, api: string): string | undefined {
	if (specifier === `${SDK_PACKAGE}/server`) {
		return `${specifier} belongs to the server half; the web half cannot import it.`;
	}
	if (specifier.startsWith(`${SDK_PACKAGE}/ui/`)) {
		return `${specifier} is not part of extension API ${api}: the extension must bring its own (a dependency it bundles, or its own code). The shared UI modules are ${sharedSdkModules(`${SDK_PACKAGE}/ui/`)}.`;
	}
	if (specifier === SDK_PACKAGE || specifier.startsWith(`${SDK_PACKAGE}/`)) {
		return `${specifier} is not part of extension API ${api}. The web half may import: ${sharedSdkModules(SDK_PACKAGE)}.`;
	}
	return undefined;
}

function privateRejection(specifier: string, api: string): string {
	const counterpart = sdkCounterpart(specifier);
	if (counterpart !== undefined && isSharedSpecifier(counterpart)) {
		return `${specifier} is private to the ThinkRail repository; import ${counterpart} instead.`;
	}
	const reason = counterpart === undefined ? undefined : sdkRejection(counterpart, api);
	return reason === undefined
		? `${specifier} is private to the ThinkRail repository and not part of extension API ${api}. The web half may import: ${sharedSdkModules(SDK_PACKAGE)}.`
		: `${specifier} is private to the ThinkRail repository, and ${reason}`;
}

export function rejection(specifier: string, api: string): string | undefined {
	if (specifier === "react/compiler-runtime" || specifier === "react-compiler-runtime") {
		return `${specifier} is not shared in extension API ${api}: build the web half without the React Compiler (it would bundle a second React runtime).`;
	}
	if (specifier === "react-dom/client") {
		return "react-dom/client is owned by ThinkRail: a web half renders through its tool renderers and never creates its own React root.";
	}
	if (/^react(?:-dom)?\//.test(specifier)) {
		return `${specifier} is not shared in extension API ${api}, and bundling it would load a second React. Shared React modules: react, react/jsx-runtime, react-dom.`;
	}
	const sdk = sdkRejection(specifier, api);
	if (sdk !== undefined) return sdk;
	if (PRIVATE.test(specifier)) return privateRejection(specifier, api);
	if (/\.css$/.test(specifier)) {
		return `${specifier}: a web half cannot import CSS from JavaScript; pass the file to \`thinkrail-extension build --css\` instead.`;
	}
	return undefined;
}

function packageName(specifier: string): string {
	const segments = specifier.split("/");
	return (specifier.startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1)).join("/");
}

function isBare(specifier: string): boolean {
	return !specifier.startsWith(".") && !specifier.startsWith("\0") && !isAbsolute(specifier);
}

export function bundledImports(code: string): string[] {
	const { module } = parseSync("bundle.js", code);
	const sources = [
		...module.staticImports.map((entry) => entry.moduleRequest.value),
		...module.staticExports.flatMap((entry) =>
			entry.entries.flatMap((exported) =>
				exported.moduleRequest ? [exported.moduleRequest.value] : [],
			),
		),
		...module.dynamicImports.flatMap(({ moduleRequest }) => {
			const literal = /^(["'`])(.*)\1$/s.exec(code.slice(moduleRequest.start, moduleRequest.end));
			return literal?.[2] === undefined ? [] : [literal[2]];
		}),
	];
	return [...new Set(sources)];
}

function importedBy(root: string, importer: string | undefined): string {
	return importer ? ` (imported by ${relative(root, importer)})` : "";
}

interface UnsharedName {
	name: string;
	specifier: SharedSpecifier;
	importer: string | undefined;
	pos: number;
}

function unsharedName(
	name: string | undefined,
	specifier: string | undefined,
	log: { id?: unknown; pos?: unknown },
): UnsharedName | undefined {
	if (name === undefined || specifier === undefined || !isSharedSpecifier(specifier)) return;
	const importer = typeof log.id === "string" ? log.id : undefined;
	return { name, specifier, importer, pos: typeof log.pos === "number" ? log.pos : 0 };
}

function unsharedMessage(
	manifest: SharedModulesManifest,
	root: string,
	{ name, specifier, importer }: UnsharedName,
	atRuntime = "",
): string {
	const what = name === "default" ? "the default export" : name;
	return `${what} is not part of extension API ${manifest.api}: ${specifier} exports only ${manifest.modules[specifier].join(", ")}.${atRuntime}${importedBy(root, importer)}`;
}

function missingSharedExports(error: unknown, found: UnsharedName[] = []): UnsharedName[] {
	if (typeof error !== "object" || error === null) return found;
	const log = error as Record<string, unknown>;
	if (
		log.code === "MISSING_EXPORT" &&
		typeof log.exporter === "string" &&
		log.exporter.startsWith(HOST) &&
		typeof log.message === "string"
	) {
		const name = /"([^"]+)" is not exported by/.exec(stripVTControlCharacters(log.message))?.[1];
		const missing = unsharedName(name, log.exporter.slice(HOST.length), log);
		if (missing) found.push(missing);
	}
	if (Array.isArray(log.errors))
		for (const nested of log.errors) missingSharedExports(nested, found);
	missingSharedExports(log.cause, found);
	return found;
}

function undefinedSharedRead(log: { code?: string; message: string; id?: string; pos?: number }) {
	if (log.code !== "IMPORT_IS_UNDEFINED") return undefined;
	const match =
		/Import `([^`]+)` will always be undefined because there is no matching export in '\\0thinkrail-host:([^']+)'/.exec(
			stripVTControlCharacters(log.message),
		);
	return unsharedName(match?.[1], match?.[2], log);
}

function unsharedError(
	manifest: SharedModulesManifest,
	root: string,
	names: UnsharedName[],
): ExtensionBuildError {
	const ordered = names.sort(
		(a, b) => (a.importer ?? "").localeCompare(b.importer ?? "") || a.pos - b.pos,
	);
	const messages = ordered.map((name) => unsharedMessage(manifest, root, name));
	return new ExtensionBuildError([...new Set(messages)].join("\n"));
}

function insideDependency(path: string | undefined): boolean {
	return path?.split(/[\\/]/).includes("node_modules") ?? false;
}

function hostModulesPlugin(
	manifest: SharedModulesManifest,
	root: string,
	loaded: string[],
): Plugin {
	const from = (importer: string | undefined) => importedBy(root, importer);
	const builtins = new Map<string, string | undefined>();
	return {
		name: "thinkrail-host-modules",
		async resolveId(specifier, importer) {
			if (specifier.startsWith(HOST)) return specifier;
			if (isSharedSpecifier(specifier)) return `${HOST}${specifier}`;
			if (specifier === "react/jsx-dev-runtime") return JSX_DEV;
			const reason = rejection(specifier, manifest.api);
			if (reason) throw new ExtensionBuildError(`${reason}${from(importer)}`);
			if (!isBare(specifier)) return null;
			if (await this.resolve(specifier, importer, { skipSelf: true })) return null;
			if (isBuiltin(specifier)) {
				builtins.set(specifier, importer);
				return { id: specifier, external: true, moduleSideEffects: false };
			}
			throw new ExtensionBuildError(
				`${specifier} cannot be resolved: install ${packageName(specifier)} in the extension, or remove the import.${from(importer)}`,
			);
		},
		load(id) {
			if (id === RUNTIME) return hostRuntimeSource(manifest.api);
			if (id === JSX_DEV) return jsxDevRuntimeSource(RUNTIME);
			if (!id.startsWith(HOST)) return null;
			const specifier = id.slice(HOST.length);
			if (!isSharedSpecifier(specifier)) return null;
			return hostModuleSource(manifest, specifier, RUNTIME);
		},
		generateBundle(_options, bundle) {
			for (const id of this.getModuleIds()) if (isAbsolute(id)) loaded.push(id);
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== "chunk") continue;
				const left = bundledImports(chunk.code);
				const builtin = left.find((specifier) => builtins.has(specifier));
				if (builtin !== undefined) {
					throw new ExtensionBuildError(
						`${builtin} is a Node built-in, which a web half cannot use: remove the import or use a browser alternative.${from(builtins.get(builtin))}`,
					);
				}
				if (left.length > 0) {
					throw new ExtensionBuildError(
						`the bundle still imports ${left.join(", ")}: ThinkRail loads a web half as one file and cannot resolve imports. Install the package so the build bundles it, or remove the import.`,
					);
				}
			}
		},
	};
}

export interface BundleOptions {
	root: string;
	entry: string;
	outFile: string;
	minify: boolean;
	manifest: SharedModulesManifest;
}

export async function bundleWebHalf({ root, entry, outFile, minify, manifest }: BundleOptions) {
	const warnings: string[] = [];
	const modules: string[] = [];
	const unshared: UnsharedName[] = [];
	try {
		await build({
			cwd: root,
			input: entry,
			platform: "browser",
			tsconfig: false,
			logLevel: "warn",
			onLog(level, log) {
				const read = undefinedSharedRead(log);
				if (read === undefined) {
					if (level === "warn") warnings.push(log.message);
				} else if (insideDependency(read.importer)) {
					warnings.push(unsharedMessage(manifest, root, read, " It is undefined at runtime."));
				} else unshared.push(read);
			},
			transform: {
				jsx: { runtime: "automatic", importSource: "react", development: false },
				define: { "process.env.NODE_ENV": JSON.stringify("production") },
			},
			plugins: [hostModulesPlugin(manifest, root, modules)],
			output: { file: outFile, format: "esm", minify, codeSplitting: false },
			write: true,
		});
	} catch (error) {
		if (error instanceof ExtensionBuildError) throw error;
		const nested = findBuildError(error);
		if (nested) throw nested;
		const missing = missingSharedExports(error);
		if (missing.length > 0) throw unsharedError(manifest, root, [...missing, ...unshared]);
		throw new ExtensionBuildError(
			`bundling ${relative(root, entry)} failed:\n${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (unshared.length > 0) throw unsharedError(manifest, root, unshared);
	return { warnings: [...new Set(warnings)], modules };
}

function findBuildError(error: unknown): ExtensionBuildError | undefined {
	if (error instanceof ExtensionBuildError) return error;
	if (!(error instanceof Error)) return undefined;
	const nested = (error as Error & { errors?: unknown[] }).errors;
	for (const candidate of nested ?? []) {
		const found = findBuildError(candidate);
		if (found) return found;
	}
	return findBuildError(error.cause);
}
