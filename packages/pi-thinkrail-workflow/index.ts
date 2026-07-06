// pi-thinkrail-workflow extension entry — registers the project-wide `before_agent_start` rule that
// nudges the agent toward the brainstorming skill before creative/feature work. The workflow itself lives
// in the skill, delivered via the package's `pi.skills` manifest / thinkrail's `additionalSkillPaths`; see
// SPEC.md "Knowledge delivery".

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * The always-on, project-wide rule: brainstorm before building. Injected unconditionally, once per agent
 * run, via `before_agent_start`. Kept short and byte-stable so it rides every run without churning
 * provider prompt-caching (mirrors pi-spec-graph's `SPEC_RULE`).
 */
export const WORKFLOW_RULE = [
	"Before starting any creative or feature work — a new feature, a nontrivial change, a design decision —",
	"read the brainstorming skill FIRST and follow it: clarify intent, propose approaches, and record an",
	"explicit design decision in a spec before writing implementation code.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${WORKFLOW_RULE}`,
	}));
};

export default factory;
