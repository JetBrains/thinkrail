// pi-spec-graph extension entry — the public surface loaded by vanilla pi (`pi install`) and by
// thinkrail (`additionalExtensionPaths`). Registers the seven spec tools and the project-wide
// `before_agent_start` rule. The concept/schema skill is delivered via the package's `pi.skills`
// manifest (vanilla pi) or `additionalSkillPaths` (thinkrail); see SPEC.md "Knowledge delivery".

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerSpecTools } from "./tools/index.ts";

/**
 * The always-on, project-wide rule (SPEC.md "Knowledge delivery"): specs are the ground truth. Injected
 * unconditionally, once per agent run, via `before_agent_start`. Kept short and byte-stable so it rides
 * every run without churning provider prompt-caching.
 */
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
