import type { NativeLspBridge } from "@thinkrail/contracts";

const NATIVE_LSP_GLOBAL = "__THINKRAIL_NATIVE_LSP__";

/** The shell's LSP bridge, or `null` in a browser or a shell without one. */
export function getNativeLspBridge(scope: object = globalThis): NativeLspBridge | null {
	let value: unknown;
	try {
		value = Reflect.get(scope, NATIVE_LSP_GLOBAL);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	try {
		return typeof Reflect.get(value, "detect") === "function" &&
			typeof Reflect.get(value, "restart") === "function" &&
			typeof Reflect.get(value, "openUserConfig") === "function"
			? (value as NativeLspBridge)
			: null;
	} catch {
		return null;
	}
}
