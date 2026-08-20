import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerSpecTools } from "./tools/index.ts";

const SPEC_RULE = [
	"Specs are this project's ground truth.",
	"- Before you explore the codebase, plan, start a task, or add/change a feature, FIRST read the spec-graph skill, then use spec_grep/spec_get/spec_graph to find and read the relevant specs — specs before code.",
	"- Treat their decisions and contracts as authoritative; reconcile every change against them and surface any contradiction instead of diverging.",
	"- When a change alters a boundary, contract, or decision, update the spec as part of that change.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	registerSpecTools(pi);

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${SPEC_RULE}`,
	}));
};

export default factory;
