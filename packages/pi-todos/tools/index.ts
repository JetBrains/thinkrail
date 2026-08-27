import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTodoAdd } from "./add.ts";
import { registerTodoList } from "./list.ts";
import { registerTodoPlanSummary } from "./planSummary.ts";
import { registerTodoRemove } from "./remove.ts";
import { registerTodoUpdate } from "./update.ts";
import { registerTodoWrite } from "./write.ts";

export function registerTodoTools(pi: ExtensionAPI): void {
	registerTodoList(pi);
	registerTodoAdd(pi);
	registerTodoUpdate(pi);
	registerTodoRemove(pi);
	registerTodoWrite(pi);
	registerTodoPlanSummary(pi);
}
