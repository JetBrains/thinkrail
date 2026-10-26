import { StringEnum } from "@earendil-works/pi-ai/compat";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { countItems, flatItems, TODO_STATUSES, type TodoPlan } from "../core/index.ts";
import {
	consistencyNudge,
	errorResult,
	formatPlan,
	formatTodo,
	storeFor,
	textResult,
	withNudges,
} from "./shared.ts";

const MAX_PAGE_LINES = DEFAULT_MAX_LINES - 10;

const parameters = Type.Object({
	status: Type.Optional(
		StringEnum(TODO_STATUSES, {
			description:
				"Filter to one status: pending | in_progress | done (flat across groups). Omit for the whole plan.",
		}),
	),
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			description:
				"Zero-based rendered-line offset (default: 0). Continue with the offset given in the result and the same status filter; restart after plan edits.",
		}),
	),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			description: `Lines per page (default: 200, max: ${MAX_PAGE_LINES}; the byte limit may return fewer).`,
		}),
	),
});

export function registerTodoList(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, { plan: TodoPlan; nextOffset?: number } | { error: string }>({
		name: "todo_list",
		label: "Todo List",
		description:
			"Read this chat's TODO plan — loose items plus named groups (optionally filtered by status). The plan is the source of truth and the user may edit it at any time, so re-read before choosing each next item, after user input, and before completion. Results are paginated; use the returned offset to continue when needed. Text is capped at 2,000 lines / 50 KiB; oversized text is saved to a temporary file.",
		promptSnippet:
			"todo_list — read this chat's TODO plan (source of truth; re-read to catch the user's edits).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const offset = params.offset ?? 0;
			const limit = Math.min(params.limit ?? 200, MAX_PAGE_LINES);
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(limit) ||
				limit < 1
			) {
				return errorResult("Use a nonnegative integer offset and a positive integer limit.");
			}
			const plan = storeFor(ctx).read();
			const filtered: TodoPlan = params.status
				? {
						todos: plan.todos.filter((todo) => todo.status === params.status),
						groups: plan.groups
							.map((group) => ({
								...group,
								todos: group.todos.filter((todo) => todo.status === params.status),
							}))
							.filter((group) => group.todos.length > 0),
					}
				: plan;
			const items = flatItems(filtered);
			const rendered = params.status
				? items.length
					? items.map(formatTodo).join("\n")
					: `No ${params.status} TODOs.`
				: countItems(plan)
					? withNudges(formatPlan(plan), consistencyNudge(plan))
					: "The plan is empty.";
			const lines = rendered.split("\n");
			if (offset >= lines.length)
				return textResult("No more plan lines. Restart at offset: 0 if the plan changed.", {
					plan: filtered,
				});
			const candidate = lines.slice(offset, offset + limit).join("\n");
			const page = truncateHead(candidate, { maxBytes: DEFAULT_MAX_BYTES - 2048, maxLines: limit });
			const count = page.firstLineExceedsLimit ? 1 : page.outputLines;
			const body = page.firstLineExceedsLimit ? (lines[offset] ?? "") : page.content;
			const nextOffset = offset + count < lines.length ? offset + count : undefined;
			const continuation =
				nextOffset === undefined
					? ""
					: `More plan lines: call todo_list with offset: ${nextOffset}${params.status ? ` and status: ${params.status}` : ""}. Restart at offset: 0 after plan edits.`;
			return textResult(
				body,
				{ plan: filtered, ...(nextOffset === undefined ? {} : { nextOffset }) },
				continuation,
			);
		},
	});
}
