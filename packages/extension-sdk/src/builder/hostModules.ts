import {
	apiMajor,
	HOST_OBJECT,
	SDK_PACKAGE,
	SHARED_SPECIFIERS,
	type SharedModulesManifest,
	type SharedSpecifier,
} from "../shared";

const DEFAULT_EXPORTING: readonly SharedSpecifier[] = ["react", "react/jsx-runtime", "react-dom"];

export function isSharedSpecifier(specifier: string): specifier is SharedSpecifier {
	return (SHARED_SPECIFIERS as readonly string[]).includes(specifier);
}

export function hostRuntimeSource(api: string): string {
	const major = apiMajor(api);
	return [
		`const host = globalThis[${JSON.stringify(HOST_OBJECT)}];`,
		`if (!host || typeof host.api !== "string" || !host.modules) throw new Error("This ThinkRail extension runs only inside ThinkRail: globalThis.${HOST_OBJECT} is missing.");`,
		`if (host.api.split(".")[0] !== ${JSON.stringify(major)}) throw new Error("This ThinkRail extension was built for extension API ${api}; this ThinkRail provides extension API " + host.api + ".");`,
		"export function hostModule(specifier) {",
		"\tconst shared = host.modules[specifier];",
		`\tif (!shared) throw new Error("ThinkRail does not share " + specifier + " with extensions (extension API " + host.api + ").");`,
		"\treturn shared;",
		"}",
		"",
	].join("\n");
}

export function hostModuleSource(
	manifest: SharedModulesManifest,
	specifier: SharedSpecifier,
	runtimeImport: string,
): string {
	const lines = [
		`import { hostModule } from ${JSON.stringify(runtimeImport)};`,
		`const shared = hostModule(${JSON.stringify(specifier)});`,
		...manifest.modules[specifier].map((name) => `export const ${name} = shared.${name};`),
	];
	if (DEFAULT_EXPORTING.includes(specifier)) lines.push("export default shared.default ?? shared;");
	return `${lines.join("\n")}\n`;
}

export function jsxDevRuntimeSource(runtimeImport: string): string {
	return [
		`import { hostModule } from ${JSON.stringify(runtimeImport)};`,
		`const shared = hostModule("react/jsx-runtime");`,
		"export const Fragment = shared.Fragment;",
		"export const jsxDEV = (type, props, key) => shared.jsx(type, props, key);",
		"",
	].join("\n");
}

export function stubFileName(specifier: SharedSpecifier): string | undefined {
	return specifier.startsWith(`${SDK_PACKAGE}/`)
		? `${specifier.slice(SDK_PACKAGE.length + 1)}.js`
		: undefined;
}
