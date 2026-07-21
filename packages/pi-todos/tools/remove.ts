// todo_remove — drop an item from the backlog. User-owned; remove only when asked.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { errorResult, storeFor, textResult } from "./shared.ts";

const parameters = Type.Object({
	id: Type.String({ description: "Id of the item to remove." }),
});

export function registerTodoRemove(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { id: string } | { error: string }>({
		name: "todo_remove",
		label: "Todo Remove",
		description:
			"Delete an item from the list by id. Rarely needed: a finished item is marked done (todo_update), not removed — done items stay as the user's history. Remove only when the user explicitly asks to drop an item.",
		promptSnippet:
			"todo_remove — delete an item (only when the user asks; done items stay, not removed).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const removed = storeFor(ctx).remove(params.id);
			if (!removed) return errorResult(`No TODO with id "${params.id}".`);
			return textResult(`Removed ${params.id}.`, { id: params.id });
		},
	});
}
