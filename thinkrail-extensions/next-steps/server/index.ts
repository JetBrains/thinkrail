import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createNextStepsExtension } from "@thinkrail/pi-next-steps";

export default defineServerExtension({
	name: "next-steps",
	title: "Next-step suggestions",
	description:
		"Lets the agent offer one-click next messages above the composer when it finishes a turn.",
	extensions: [createNextStepsExtension()],
});
