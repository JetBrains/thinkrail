import {
	EXT_RUNTIME_GLOBAL,
	EXT_RUNTIME_MODULES,
	EXT_VIEW_EXPORTS,
	type ExtRuntimeModule,
} from "@thinkrail/contracts";
import type { BunPlugin } from "bun";

const NAMESPACE = "thinkrail-runtime";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export type RuntimeExportLists = Record<ExtRuntimeModule, readonly string[]>;

const exportNames = (module: object) =>
	Object.keys(module)
		.filter((name) => name !== "default" && IDENTIFIER.test(name))
		.sort();

const loadExportLists = async (): Promise<RuntimeExportLists> => {
	const [react, jsxRuntime, jsxDevRuntime, reactDom] = await Promise.all([
		import("react"),
		import("react/jsx-runtime"),
		import("react/jsx-dev-runtime"),
		import("react-dom"),
	]);
	return {
		react: exportNames(react),
		"react/jsx-runtime": exportNames(jsxRuntime),
		"react/jsx-dev-runtime": exportNames(jsxDevRuntime),
		"react-dom": exportNames(reactDom),
		"@thinkrail/ext/view": EXT_VIEW_EXPORTS,
	};
};

let exportLists: Promise<RuntimeExportLists> | undefined;
export const runtimeExportLists = () => {
	exportLists ??= loadExportLists();
	return exportLists;
};

export const shimSource = (specifier: ExtRuntimeModule, names: readonly string[]) =>
	[
		`const m = globalThis[${JSON.stringify(EXT_RUNTIME_GLOBAL)}]?.[${JSON.stringify(specifier)}];`,
		`if (!m) throw new Error(${JSON.stringify(`ThinkRail view runtime is missing "${specifier}"`)});`,
		"export default m.default ?? m;",
		...(names.length > 0 ? [`export const { ${names.join(", ")} } = m;`] : []),
	].join("\n");

const isRuntimeModule = (specifier: string): specifier is ExtRuntimeModule =>
	EXT_RUNTIME_MODULES.some((known) => known === specifier);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const RUNTIME_FILTER = new RegExp(`^(?:${EXT_RUNTIME_MODULES.map(escapeRegExp).join("|")})$`);

export const runtimeGlobalPlugin = (lists: RuntimeExportLists): BunPlugin => ({
	name: "thinkrail-runtime-global",
	setup(build) {
		build.onResolve({ filter: RUNTIME_FILTER }, (args) => ({
			path: args.path,
			namespace: NAMESPACE,
		}));
		build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
			if (!isRuntimeModule(args.path)) throw new Error(`unknown runtime module ${args.path}`);
			return { loader: "js", contents: shimSource(args.path, lists[args.path]) };
		});
	},
});
