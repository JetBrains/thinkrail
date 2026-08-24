import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerTodoTools } from "./tools/index.ts";

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
