import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const headlessSearchPolicy: ExtensionFactory = (pi) => {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "web_search") return;
		const input = event.input;
		if (input.workflow == null) input.workflow = "none";
	});
};
