import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
	BeforeAgentStartEvent,
	NormalizedBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent";
import factory, { WORKFLOW_RULE, WORKFLOW_SECTION } from "./index.ts";

type BeforeAgentStartHandler = (event: BeforeAgentStartEvent) => unknown;

type PiSystemPromptRenderer = {
	buildSystemPromptSections: (
		options: NormalizedBuildSystemPromptOptions,
	) => Record<string, string>;
	buildSystemPrompt: (options: NormalizedBuildSystemPromptOptions) => string;
};

// pi 0.86.1 does not re-export its renderer from the package root; this reaches an internal path.
async function loadPiRenderer(): Promise<PiSystemPromptRenderer> {
	return await import(
		new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
	);
}

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

function promptOptions(): NormalizedBuildSystemPromptOptions {
	return {
		selectedTools: ["read"],
		toolSnippets: { read: "Read a file" },
		toolGuidelines: {},
		promptGuidelines: [],
		appendSystemPrompt: "",
		sections: {},
		cwd: "/workspace",
		contextFiles: [],
		skills: [],
	};
}

describe("pi-thinkrail-workflow extension", () => {
	test("contributes the workflow rule as its own prompt section", () => {
		const systemPromptOptions = promptOptions();
		const result = loadHandler()({
			type: "before_agent_start",
			prompt: "do the thing",
			systemPrompt: "You are a helpful agent.",
			systemPromptOptions,
		});

		expect(systemPromptOptions.sections).toEqual({ [WORKFLOW_SECTION]: WORKFLOW_RULE });
		expect(result).toBeUndefined();
	});

	test("pi renders the rule as its own tagged block at the tail of the prompt", async () => {
		const systemPromptOptions = promptOptions();
		loadHandler()({
			type: "before_agent_start",
			prompt: "do the thing",
			systemPrompt: "You are a helpful agent.",
			systemPromptOptions,
		});

		const { buildSystemPromptSections, buildSystemPrompt } = await loadPiRenderer();
		const sections = buildSystemPromptSections(systemPromptOptions);
		const block = `<pi-thinkrail-workflow>\n${WORKFLOW_RULE}\n</pi-thinkrail-workflow>`;
		const keys = Object.keys(sections);

		expect(sections[WORKFLOW_SECTION]).toBe(block);
		expect(keys.indexOf(WORKFLOW_SECTION)).toBeGreaterThan(keys.indexOf("cwd"));
		expect(buildSystemPrompt(systemPromptOptions)).toEndWith(block);
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

	test("creates PRs without duplicate verification or unsolicited monitoring", () => {
		const skill = readFileSync(new URL("./skills/shipping-a-pr/SKILL.md", import.meta.url), "utf8");
		const creating = readFileSync(
			new URL("./skills/shipping-a-pr/creating.md", import.meta.url),
			"utf8",
		);
		expect(skill).toContain("Create a PR — the work is finished | `creating.md` | snapshot");
		expect(skill).toContain("A push never upgrades the mode by");
		expect(creating).toContain("Do not rerun a passing command merely because PR creation");
		expect(creating).toContain("defaults to snapshot mode");
	});

	test("ties reused verification and empty check rollups to observed final state", () => {
		const skill = readFileSync(new URL("./skills/shipping-a-pr/SKILL.md", import.meta.url), "utf8");
		const creating = readFileSync(
			new URL("./skills/shipping-a-pr/creating.md", import.meta.url),
			"utf8",
		);
		const comments = readFileSync(
			new URL("./skills/shipping-a-pr/review-comments.md", import.meta.url),
			"utf8",
		);
		const checks = readFileSync(
			new URL("./skills/shipping-a-pr/checks.md", import.meta.url),
			"utf8",
		);
		expect(skill).toContain("Before every code-affecting push");
		expect(creating).toContain("repeat gates 3–5 against the new head");
		expect(comments).toContain("final-tree verification rule");
		expect(checks).toContain("no checks currently reported");
		expect(checks).toContain("Never infer “no checks configured” from one empty rollup");
	});

	test("reapplies title edits after a concurrent GitHub change", () => {
		const body = readFileSync(new URL("./skills/shipping-a-pr/body.md", import.meta.url), "utf8");
		expect(body).toContain("immediately re-fetch the current title");
		expect(body).toContain("reapply");
		expect(body).toContain("requested mutation to that fresh title");
	});
});
