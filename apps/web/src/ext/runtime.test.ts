import { expect, test } from "bun:test";
import {
	EXT_RUNTIME_GLOBAL,
	EXT_RUNTIME_MODULES,
	EXT_VIEW_EXPORTS,
	EXT_VIEW_UI_EXPORTS,
} from "@thinkrail/contracts";
import * as React from "react";
import { installRuntime, runtimeModules, viewModule, viewUi } from "./runtime";

test("the runtime global carries every module the host shims resolve", () => {
	expect(Object.keys(runtimeModules).sort()).toEqual([...EXT_RUNTIME_MODULES].sort());
	expect(Object.keys(viewModule).sort()).toEqual([...EXT_VIEW_EXPORTS].sort());
	expect(Object.keys(viewUi).sort()).toEqual([...EXT_VIEW_UI_EXPORTS].sort());
	for (const name of EXT_VIEW_UI_EXPORTS) expect(viewUi[name]).toBeDefined();
});

test("installRuntime publishes the app's React instance once", () => {
	installRuntime();
	const runtime: unknown = Reflect.get(globalThis, EXT_RUNTIME_GLOBAL);
	expect(Reflect.get(Object(runtime), "react")).toBe(React);
	installRuntime();
	expect(Reflect.get(globalThis, EXT_RUNTIME_GLOBAL)).toBe(runtime);
	expect(Object.isFrozen(runtime)).toBe(true);
	Reflect.deleteProperty(globalThis, EXT_RUNTIME_GLOBAL);
});
