import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import descriptor from "./index";

const extension: ServerExtension = descriptor;

describe("next-steps server half", () => {
	test("composes one parent extension and nothing for children, sessions or skills", () => {
		expect(extension.name).toBe("next-steps");
		expect(extension.extensions).toHaveLength(1);
		expect(extension.childExtensions).toBeUndefined();
		expect(extension.sessionExtensions).toBeUndefined();
		expect(extension.skillPackages).toBeUndefined();
		expect(extension.interactiveTools).toBeUndefined();
	});

	test("its factory is the published package's, registering suggest_next_steps", () => {
		const tools: string[] = [];
		const fakePi = {
			registerTool: (definition: { name: string }) => tools.push(definition.name),
			on: () => {},
			registerShortcut: () => {},
		};
		extension.extensions[0]?.(fakePi as unknown as ExtensionAPI);
		expect(tools).toEqual(["suggest_next_steps"]);
	});
});
