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
		hiddenTools: [],
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
			messageType: "user",
			prompt: "do the thing",
			systemPrompt: "You are a helpful agent.",
			systemPromptOptions,
		});

		expect(systemPromptOptions.sections).toEqual({ [WORKFLOW_SECTION]: WORKFLOW_RULE });
		expect(result).toBeUndefined();
	});

	test("contributes the rule to runs started by a custom message too", () => {
		const systemPromptOptions = promptOptions();
		loadHandler()({
			type: "before_agent_start",
			messageType: "custom",
			message: {
				role: "custom",
				customType: "test",
				content: "continue",
				display: false,
				timestamp: 0,
			},
			systemPrompt: "You are a helpful agent.",
			systemPromptOptions,
		});

		expect(systemPromptOptions.sections).toEqual({ [WORKFLOW_SECTION]: WORKFLOW_RULE });
	});

	test("pi renders the rule as its own tagged block at the tail of the prompt", async () => {
		const systemPromptOptions = promptOptions();
		loadHandler()({
			type: "before_agent_start",
			messageType: "user",
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

	test("sends reviewing a pull request to the router like PR lifecycle work", () => {
		const [entry = ""] = WORKFLOW_RULE.split("\n");
		expect(entry).toContain("read the choosing-a-workflow skill");
		expect(entry).toContain("reviewing a pull request you are not shipping");
		const router = readFileSync(
			new URL("./skills/choosing-a-workflow/SKILL.md", import.meta.url),
			"utf8",
		);
		expect(router).toContain(
			"| Reviewing a PR the user is not shipping | Read and follow **reviewing-a-pr** |",
		);
	});

	test("ships every reviewing-a-pr stage doc the spine names, each with its successor", () => {
		const dir = new URL("./skills/reviewing-a-pr/", import.meta.url);
		const spine = readFileSync(new URL("SKILL.md", dir), "utf8");
		const stages = [
			"intake",
			"measuring",
			"mapping",
			"hunting",
			"challenging",
			"assessing",
			"brief",
		];
		for (const stage of [...stages, "posting"]) {
			expect(spine).toContain(`\`${stage}.md\``);
		}
		for (const stage of stages) {
			expect(readFileSync(new URL(`${stage}.md`, dir), "utf8")).toContain("\n## Next\n");
		}
		expect(readFileSync(new URL("posting.md", dir), "utf8")).toContain("## Terminal states");
		expect(readFileSync(new URL("brief-template.html", dir), "utf8")).not.toContain("<script");
	});

	test("reviewing-a-pr reads and posts the picked PR's own repository, never gh's default", () => {
		const dir = new URL("./skills/reviewing-a-pr/", import.meta.url);
		for (const doc of ["intake.md", "posting.md"]) {
			const text = readFileSync(new URL(doc, dir), "utf8");
			expect(text).not.toMatch(/gh pr (view|checks) <n>/);
			expect(text).toContain("gh pr view <url>");
		}
		const intake = readFileSync(new URL("intake.md", dir), "utf8");
		expect(intake).toContain("git reset --hard <name>/pr-<n>");
		expect(intake).toContain("git merge-base <mergeCommit>^1 HEAD");
	});

	test("reviewing-a-pr asks prompts for a pull request and never moves a checkout with work", () => {
		const dir = new URL("./skills/reviewing-a-pr/", import.meta.url);
		const spine = readFileSync(new URL("SKILL.md", dir), "utf8");
		const frontmatter = spine.split("\n---\n")[0] ?? "";
		expect(frontmatter).toContain("\nargument-completion: pull-request");
		const intake = readFileSync(new URL("intake.md", dir), "utf8");
		expect(intake).toContain("`start_workspace`");
		expect(intake).toContain("**Handed off**");
		expect(intake).toContain("`git rev-parse --git-dir`\ndiffers from `--git-common-dir`");
		expect(intake).toContain("do not hand off again.");
		expect(intake).toContain("`branch: Created from` or `Branch: renamed`");
		expect(intake).toContain("never hands off again");
		expect(spine).toContain("hand-off to a separate review workspace");
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
