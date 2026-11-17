import { relative } from "node:path";
import { build, type Plugin } from "rolldown";
import { SDK_PACKAGE, SHARED_SPECIFIERS, type SharedModulesManifest } from "../shared";
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

const PRIVATE_HINTS: [RegExp, string][] = [
	[/^@thinkrail\/ui\/(.+)$/, `${SDK_PACKAGE}/ui/$1`],
	[/^@thinkrail\/extension-api(?:\/web)?$/, `${SDK_PACKAGE}/web`],
	[/^@thinkrail\/resource-renderers$/, `${SDK_PACKAGE}/resources`],
];

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
	if (specifier === `${SDK_PACKAGE}/server`) {
		return `${specifier} belongs to the server half; the web half cannot import it.`;
	}
	if (specifier === SDK_PACKAGE || specifier.startsWith(`${SDK_PACKAGE}/`)) {
		const shared = SHARED_SPECIFIERS.filter((name) => name.startsWith(SDK_PACKAGE)).join(", ");
		return `${specifier} is not part of extension API ${api}. The web half may import: ${shared}.`;
	}
	for (const [pattern, replacement] of PRIVATE_HINTS) {
		if (pattern.test(specifier)) {
			return `${specifier} is private to the ThinkRail repository; import ${specifier.replace(pattern, replacement)} instead.`;
		}
	}
	if (/\.css$/.test(specifier)) {
		return `${specifier}: a web half cannot import CSS from JavaScript; pass the file to \`thinkrail-extension build --css\` instead.`;
	}
	return undefined;
}

function hostModulesPlugin(manifest: SharedModulesManifest, root: string): Plugin {
	return {
		name: "thinkrail-host-modules",
		resolveId(specifier, importer) {
			if (specifier.startsWith(HOST)) return specifier;
			if (isSharedSpecifier(specifier)) return `${HOST}${specifier}`;
			if (specifier === "react/jsx-dev-runtime") return JSX_DEV;
			const reason = rejection(specifier, manifest.api);
			if (reason) {
				const from = importer ? ` (imported by ${relative(root, importer)})` : "";
				throw new ExtensionBuildError(`${reason}${from}`);
			}
			return null;
		},
		load(id) {
			if (id === RUNTIME) return hostRuntimeSource(manifest.api);
			if (id === JSX_DEV) return jsxDevRuntimeSource(RUNTIME);
			if (!id.startsWith(HOST)) return null;
			const specifier = id.slice(HOST.length);
			if (!isSharedSpecifier(specifier)) return null;
			return hostModuleSource(manifest, specifier, RUNTIME);
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
	try {
		await build({
			cwd: root,
			input: entry,
			platform: "browser",
			tsconfig: false,
			logLevel: "warn",
			onLog(level, log) {
				if (level === "warn") warnings.push(log.message);
			},
			transform: {
				jsx: { runtime: "automatic", importSource: "react", development: false },
				define: { "process.env.NODE_ENV": JSON.stringify("production") },
			},
			plugins: [hostModulesPlugin(manifest, root)],
			output: { file: outFile, format: "esm", minify, codeSplitting: false },
			write: true,
		});
		return { warnings };
	} catch (error) {
		if (error instanceof ExtensionBuildError) throw error;
		const nested = findBuildError(error);
		if (nested) throw nested;
		throw new ExtensionBuildError(
			`bundling ${relative(root, entry)} failed:\n${error instanceof Error ? error.message : String(error)}`,
		);
	}
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
