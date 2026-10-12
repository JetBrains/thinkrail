import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_SECTION = "pi-thinkrail-workflow";

export const WORKFLOW_RULE = [
	"At the start of a new piece of work, read the choosing-a-workflow skill before any other tool call for project onboarding, PR lifecycle work (including checking a PR's CI), or any change to what the product does — a feature, a behavior change, or a bug fix, however small.",
	"Non-PR questions, explanations, and checks, and edits that change no behavior (typos, documentation or configuration only, mechanical refactors), proceed directly without loading or announcing a workflow.",
	"Continue work already routed to a workflow without routing it again.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections[WORKFLOW_SECTION] = WORKFLOW_RULE;
	});
};

export default factory;
