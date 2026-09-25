import {
	EXT_RUNTIME_GLOBAL,
	EXT_RUNTIME_MODULES,
	EXT_VIEW_EXPORTS,
	type ExtRuntimeModule,
} from "@thinkrail/contracts";
import type { BunPlugin } from "bun";

const NAMESPACE = "thinkrail-runtime";
const VIEW_MODULE = "@thinkrail/ext/view";

const lookup = (specifier: ExtRuntimeModule) =>
	[
		`const m = globalThis[${JSON.stringify(EXT_RUNTIME_GLOBAL)}]?.[${JSON.stringify(specifier)}];`,
		`if (!m) throw new Error(${JSON.stringify(`ThinkRail view runtime is missing "${specifier}"`)});`,
	].join("\n");

export const shimSource = (specifier: ExtRuntimeModule) =>
	specifier === VIEW_MODULE
		? [lookup(specifier), `export const { ${EXT_VIEW_EXPORTS.join(", ")} } = m;`].join("\n")
		: [lookup(specifier), "module.exports = m;"].join("\n");

const isRuntimeModule = (specifier: string): specifier is ExtRuntimeModule =>
	EXT_RUNTIME_MODULES.some((known) => known === specifier);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const RUNTIME_FILTER = new RegExp(`^(?:${EXT_RUNTIME_MODULES.map(escapeRegExp).join("|")})$`);

export const runtimeGlobalPlugin: BunPlugin = {
	name: "thinkrail-runtime-global",
	setup(build) {
		build.onResolve({ filter: RUNTIME_FILTER }, (args) => ({
			path: args.path,
			namespace: NAMESPACE,
		}));
		build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
			if (!isRuntimeModule(args.path)) throw new Error(`unknown runtime module ${args.path}`);
			return { loader: "js", contents: shimSource(args.path) };
		});
	},
};
