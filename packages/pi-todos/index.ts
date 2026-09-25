import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerTodoTools } from "./tools/index.ts";

const TODO_SECTION = "pi-todos";

const TODO_RULE = [
	"This chat has a shared TODO list — your live plan for the conversation, which the user edits too.",
	"A pending user-origin item already in that list is worked through its exact item with todo_update, regardless of size.",
	"When the user asks for a plan or new work needs at least three substantive execution steps, read the todos skill, create a concise plan once the task is understood enough to plan, and keep it current.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	registerTodoTools(pi);

	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections[TODO_SECTION] = TODO_RULE;
	});
};

export default factory;
