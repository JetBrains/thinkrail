// Public surface of the tools layer: register all seven spec tools onto a pi ExtensionAPI. The
// extension entry (`../index.ts`) is the only caller. Each tool is a thin wrapper over `core/`.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSpecCreate } from "./create.ts";
import { registerSpecDelete } from "./delete.ts";
import { registerSpecGet } from "./get.ts";
import { registerSpecGraph } from "./graph.ts";
import { registerSpecGrep } from "./grep.ts";
import { registerSpecUpdate } from "./update.ts";
import { registerSpecValidate } from "./validate.ts";

/** Register `spec_grep`, `spec_get`, `spec_graph`, `spec_create`, `spec_update`, `spec_delete`, `spec_validate`. */
export function registerSpecTools(pi: ExtensionAPI): void {
	registerSpecGrep(pi);
	registerSpecGet(pi);
	registerSpecGraph(pi);
	registerSpecCreate(pi);
	registerSpecUpdate(pi);
	registerSpecDelete(pi);
	registerSpecValidate(pi);
}
