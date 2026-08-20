import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSpecCreate } from "./create.ts";
import { registerSpecDelete } from "./delete.ts";
import { registerSpecGet } from "./get.ts";
import { registerSpecGraph } from "./graph.ts";
import { registerSpecGrep } from "./grep.ts";
import { registerSpecUpdate } from "./update.ts";
import { registerSpecValidate } from "./validate.ts";

export function registerSpecTools(pi: ExtensionAPI): void {
	registerSpecGrep(pi);
	registerSpecGet(pi);
	registerSpecGraph(pi);
	registerSpecCreate(pi);
	registerSpecUpdate(pi);
	registerSpecDelete(pi);
	registerSpecValidate(pi);
}
