import { defineWebExtension } from "@thinkrail/extension-api/web";
import { PresentedFiles } from "./PresentedFiles";
import { readPresentedFiles } from "./presented";

export default defineWebExtension({
	name: "outputs",
	toolRenderers: {
		present_files: {
			renderer: PresentedFiles,
			options: {
				chrome: "bare",
				summary: ({ args, result }, translate) =>
					translate("outputs.summary", { count: readPresentedFiles(args, result).length }),
			},
		},
	},
});
