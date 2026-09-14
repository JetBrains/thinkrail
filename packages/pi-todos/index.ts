import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerTodoTools } from "./tools/index.ts";

const TODO_RULE = [
	"This chat has a shared TODO list — your live plan for the conversation, which the user edits too.",
	"When the user asks for a plan or the task needs at least three substantive execution steps, read the todos skill, create a concise plan once the task is understood enough to plan, and keep it current at material milestones.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	registerTodoTools(pi);

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${TODO_RULE}`,
	}));
};

export default factory;
