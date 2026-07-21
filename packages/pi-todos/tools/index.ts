// Public surface of the tools layer: register all five todo tools onto a pi ExtensionAPI. The extension
// entry (`../index.ts`) is the only caller. Each tool is a thin wrapper over `core/`.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTodoAdd } from "./add.ts";
import { registerTodoList } from "./list.ts";
import { registerTodoRemove } from "./remove.ts";
import { registerTodoUpdate } from "./update.ts";
import { registerTodoWrite } from "./write.ts";

/** Register `todo_list`, `todo_add`, `todo_update`, `todo_remove`, `todo_write`. */
export function registerTodoTools(pi: ExtensionAPI): void {
	registerTodoList(pi);
	registerTodoAdd(pi);
	registerTodoUpdate(pi);
	registerTodoRemove(pi);
	registerTodoWrite(pi);
}
