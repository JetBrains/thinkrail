import { defineServerExtension } from "@thinkrail/extension-api/server";
import { createLspSearchExtension } from "./tools";

export default defineServerExtension({
	name: "lsp-search",
	title: "Code navigation (LSP)",
	description:
		"Lets the agent find symbols, references, definitions and file outlines through the project's language servers, with a text-search fallback.",
	extensions: [createLspSearchExtension()],
	childExtensions: [createLspSearchExtension()],
});
