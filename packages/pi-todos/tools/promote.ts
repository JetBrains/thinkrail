import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TodoGroup, TodoPromoteFailure } from "../core/index.ts";
import { consistencyNudge, errorResult, storeFor, textResult, withNudges } from "./shared.ts";

const FAILURE_MESSAGES: Record<TodoPromoteFailure, (id: string, title?: string) => string> = {
	"unknown-id": (id) =>
		`No TODO with id "${id}". Check the id with todo_list; a stale id from an older plan read never matches.`,
	"grouped-step": (id) =>
		`"${id}" is already a step inside a group. Promotion only applies to loose items (todo_promote adds a group of its own; a grouped step is already in one).`,
	"empty-title": (_id, title) =>
		`Resolved group title is empty${title ? ` (override "${title}" normalized to nothing)` : ""}. Pass a non-empty \`title:\` so the group has an addressable name for later todo_add group: calls.`,
	"title-collision": (_id, title) =>
		`A group titled ${title ? `"${title}"` : "the loose item's title"} already exists. Pass a disambiguating \`title:\` on todo_promote (a silent merge would make the loose ask disappear without adding any step).`,
};

const parameters = Type.Object({
	id: Type.String({
		description:
			"Id of the loose item to promote (must be a loose-lane item — a grouped step is already in a group, so promotion doesn't apply).",
	}),
	title: Type.Optional(
		Type.String({
			description:
				"Optional override for the new group's title. When omitted, the loose item's own title becomes the group title verbatim — preserve the user's wording unless you have a clear reason to rephrase.",
		}),
	),
});

export function registerTodoPromote(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { group: TodoGroup } | { error: string }>({
		name: "todo_promote",
		label: "Todo Promote",
		description:
			'Promote one loose item into a group of its own in a single atomic step. The item disappears from the loose lane and a group inherits its id (and its title, unless you pass `title`). No duplicate window and no `todo_remove` dance — this IS the promotion. Use it the moment you take a loose item into work (typically a user-authored ask): one `todo_promote`, then `todo_add` the first step and flip it `in_progress`. The empty group is a valid "task taken, plan forming" state — don\'t backfill it with a synthetic placeholder.',
		promptSnippet:
			"todo_promote — turn one loose item into a group of its own (same id, same title), ready for todo_add to append its steps.",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const store = storeFor(ctx);
			const result = store.promote(params.id, params.title);
			if (!result.ok) {
				return errorResult(FAILURE_MESSAGES[result.reason](params.id, params.title));
			}
			const group = result.group;
			return textResult(
				withNudges(
					`Promoted ${params.id} → group "${group.title}" (${group.id}). Add its first step with todo_add group:"${group.title}" and flip it in_progress.`,
					consistencyNudge(store.read()),
				),
				{ group },
			);
		},
	});
}
