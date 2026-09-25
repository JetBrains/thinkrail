import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_SECTION = "pi-thinkrail-workflow";

export const WORKFLOW_RULE = [
	"At the start of a new piece of work, read the choosing-a-workflow skill for project onboarding or any PR lifecycle work.",
	"For other new changes, read it only when product scope, user-visible behavior, or architecture remains to decide.",
	"Continue work already routed to a workflow without routing it again; otherwise proceed directly without loading or announcing one.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections[WORKFLOW_SECTION] = WORKFLOW_RULE;
	});
};

export default factory;
