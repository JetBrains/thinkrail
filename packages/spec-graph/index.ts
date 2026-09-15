import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { registerSpecTools } from "./tools/index.ts";

const SPEC_RULE = [
	"Specs are this project's ground truth.",
	"- Consult the relevant spec when work is governed by or may alter a documented boundary, contract, invariant, behavior, or architecture decision; localized work need not read unrelated specs.",
	"- Treat applicable decisions and contracts as authoritative; reconcile contradictions instead of diverging.",
	"- When a change alters a boundary, contract, invariant, or decision, update the owning spec as part of that change.",
].join("\n");

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	registerSpecTools(pi);

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${SPEC_RULE}`,
	}));
};

export default factory;
