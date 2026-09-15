import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import factory, { WORKFLOW_RULE } from "./index.ts";

type BeforeAgentStartHandler = (event: { systemPrompt: string }) => { systemPrompt: string };

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

	test("classifies every GitHub merge state before declaring a PR ready", () => {
		const checks = readFileSync(
			new URL("./skills/shipping-a-pr/checks.md", import.meta.url),
			"utf8",
		);
		for (const state of [
			"UNKNOWN",
			"BEHIND",
			"DIRTY",
			"UNSTABLE",
			"BLOCKED",
			"CLEAN",
			"HAS_HOOKS",
		]) {
			expect(checks).toContain(`\`${state}\``);
		}
		expect(checks).toContain("isDraft");
		expect(checks).toContain("reviewDecision");
		expect(checks).not.toContain("Any other computed state");
	});

	test("reapplies title edits after a concurrent GitHub change", () => {
		const body = readFileSync(new URL("./skills/shipping-a-pr/body.md", import.meta.url), "utf8");
		expect(body).toContain("immediately re-fetch the current title");
		expect(body).toContain("reapply");
		expect(body).toContain("requested mutation to that fresh title");
	});
});
