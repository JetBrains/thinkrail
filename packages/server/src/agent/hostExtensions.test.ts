import { afterEach, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { childExtensionFactories } from "./extensions";
import { hostExtensionBridge, setHostExtensionFactorySource } from "./hostExtensions";

afterEach(() => setHostExtensionFactorySource(undefined));

test("the bridge runs every source factory and isolates a throwing one", async () => {
	const calls: string[] = [];
	const failures: unknown[] = [];
	const broken: ExtensionFactory = () => {
		throw new Error("broken");
	};
	setHostExtensionFactorySource({
		factories: () => [() => void calls.push("a"), broken, async () => void calls.push("c")],
		onError: (factory, error) => failures.push(factory === broken && error),
	});
	const pi = {} as ExtensionAPI;
	await hostExtensionBridge(pi);
	expect(calls).toEqual(["a", "c"]);
	expect(failures).toHaveLength(1);
	expect(failures[0]).toBeInstanceOf(Error);
});

test("the bridge is a no-op without a source", async () => {
	await hostExtensionBridge({} as ExtensionAPI);
});

test("delegated children never get the bridge, so no ext_* tools or tr.pi factories", () => {
	expect(childExtensionFactories()).not.toContain(hostExtensionBridge);
});
