import { describe, expect, test } from "bun:test";
import factory, { WORKFLOW_RULE } from "./index.ts";

type BeforeAgentStartHandler = (event: { systemPrompt: string }) => { systemPrompt: string };

/** Run the extension factory with a fake `pi` and return the registered `before_agent_start` handler. */
function loadHandler(): BeforeAgentStartHandler {
	let captured: BeforeAgentStartHandler | undefined;
	const fakePi = {
		on: (eventName: string, handler: BeforeAgentStartHandler) => {
			if (eventName === "before_agent_start") captured = handler;
		},
	};
	factory(fakePi as unknown as Parameters<typeof factory>[0]);
	if (!captured) throw new Error("factory did not register a before_agent_start handler");
	return captured;
}

describe("pi-thinkrail-workflow extension", () => {
	test("appends the workflow rule after the existing system prompt", () => {
		const result = loadHandler()({ systemPrompt: "You are a helpful agent." });
		expect(result.systemPrompt).toBe(`You are a helpful agent.\n\n${WORKFLOW_RULE}`);
	});

	test("preserves the original system prompt verbatim as a prefix", () => {
		const original = "Some existing system prompt.\nWith multiple lines.";
		const result = loadHandler()({ systemPrompt: original });
		expect(result.systemPrompt.startsWith(original)).toBe(true);
	});
});
