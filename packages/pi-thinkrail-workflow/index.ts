// pi-thinkrail-workflow extension entry — registers the project-wide `before_agent_start` rule that
// nudges the agent toward the root router skill (`choosing-a-workflow`) at the start of any new piece of
// work. Routing and workflow steps live in the skills, delivered via the package's `pi.skills` manifest /
// thinkrail's `additionalSkillPaths`; see SPEC.md "Knowledge delivery".

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * The always-on, project-wide rule: route every new piece of work through the root router. Injected
 * unconditionally, once per agent run, via `before_agent_start`. Kept short and byte-stable so it rides
 * every run without churning provider prompt-caching (mirrors pi-spec-graph's `SPEC_RULE`).
 */
export const WORKFLOW_RULE = [
	"At the start of any new piece of work — a request, feature, change, fix, or fresh project idea —",
	"read the choosing-a-workflow skill FIRST and follow it: it routes the work to the workflow skill",
	"that governs it, or tells you none applies.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${WORKFLOW_RULE}`,
	}));
};

export default factory;
