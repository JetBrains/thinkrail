import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_RULE = [
	"For project onboarding or any PR lifecycle work, read the choosing-a-workflow skill before beginning that work.",
	"For other changes, read it only when product scope, user-visible behavior, or architecture remains to decide.",
	"Otherwise proceed directly without loading or announcing a workflow.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${WORKFLOW_RULE}`,
	}));
};

export default factory;
