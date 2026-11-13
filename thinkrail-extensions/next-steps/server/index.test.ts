import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import descriptor from "./index";

const extension: ServerExtension = descriptor;

type ExecResult = {
	content: Array<{ type: string; text: string }>;
	details: { suggestions: string[] };
	terminate?: boolean;
};
type CapturedTool = {
	name: string;
	promptGuidelines?: string[];
	execute: (id: string, params: unknown) => Promise<ExecResult>;
};

function loadTool(): CapturedTool {
	let captured: CapturedTool | undefined;
	const fakePi = {
		registerTool: (def: CapturedTool) => {
			captured = def;
		},
	};
	const factory = extension.extensions[0];
	if (!factory) throw new Error("server half declares no extension factory");
	factory(fakePi as unknown as ExtensionAPI);
	if (!captured) throw new Error("factory did not register a tool");
	return captured;
}

describe("next-steps server half", () => {
	test("composes one parent extension and nothing for children, sessions or skills", () => {
		expect(extension.name).toBe("next-steps");
		expect(extension.extensions).toHaveLength(1);
		expect(extension.childExtensions).toBeUndefined();
		expect(extension.sessionExtensions).toBeUndefined();
		expect(extension.skillPackages).toBeUndefined();
		expect(extension.interactiveTools).toBeUndefined();
	});

	test("registers suggest_next_steps with guidance to call it last and alone", () => {
		const tool = loadTool();
		expect(tool.name).toBe("suggest_next_steps");
		expect(tool.promptGuidelines?.join(" ")).toContain("very last action");
	});

	test("normalizes suggestions and ends the turn", async () => {
		const result = await loadTool().execute("call-1", {
			suggestions: ["  Run the   e2e suite ", "", "run the e2e suite", "Open a PR"],
		});
		expect(result.details.suggestions).toEqual(["Run the e2e suite", "Open a PR"]);
		expect(result.terminate).toBe(true);
	});

	test("still ends the turn when nothing usable remains", async () => {
		const result = await loadTool().execute("call-2", { suggestions: ["   "] });
		expect(result.details.suggestions).toEqual([]);
		expect(result.terminate).toBe(true);
	});
});
