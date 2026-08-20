import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

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
