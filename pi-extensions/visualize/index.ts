import { createVisualizeExtension } from "./src/extension.ts";

export type {
	FileChecker,
	MermaidValidator,
	VisualizeExtensionOptions,
} from "./src/extension.ts";
export { createVisualizeExtension } from "./src/extension.ts";
export type { ComparisonOption, VisualizeParams } from "./src/schema.ts";

export default createVisualizeExtension();
