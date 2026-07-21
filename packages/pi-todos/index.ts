// pi-todos extension entry — the public surface loaded by vanilla pi (`pi install`) and by thinkrail
// (`additionalExtensionPaths`). Registers the five todo tools and one always-on `before_agent_start`
// rule. The rule only makes the agent *aware* of the list + tools and points at the todos skill; how to
// work with the list lives in the skill, and each tool's invariants live in its own description — we lean
// on those (the agent's understanding), not on piling text into every prompt. Skill delivery: the
// package's `pi.skills` manifest (vanilla pi) or `additionalSkillPaths` (thinkrail).

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerTodoTools } from "./tools/index.ts";

/**
 * The always-on rule: short, byte-stable, and a *pointer* (to the tools + skill), not a restatement —
 * so it rides every run without churning provider prompt-caching. The discipline is in the skill.
 */
const TODO_RULE = [
	"This chat has a shared TODO list — your live plan for the conversation, which the user edits too.",
	"For any multi-step request, the FIRST thing you do is todo_write your PROPOSED plan — before asking clarifying questions and before doing the work — so the plan is visible while you form it, not backfilled after it's approved. Then keep it current (refine it, flip items) as you clarify, get feedback, and execute. Read the todos skill for how.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	registerTodoTools(pi);

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${TODO_RULE}`,
	}));
};

export default factory;
