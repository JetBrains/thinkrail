import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { flatItems, groupProgress } from "./planView";

// Compile a chat's TODO plan to a temporary, human-readable markdown snapshot (SPEC §Chat TODO plan) — the
// "Open as markdown" action in the plan popup. Pure + presentational-adjacent (no store/transport): it
// just maps the plan to GFM. Structure mirrors the plan's own shape — named groups as `##` sections, the
// loose items last — with a progress header and GFM task-list checkboxes.

/** GFM task-list box for a status: done `[x]`, pending `[ ]`, in-progress `[~]` (a distinct middle mark). */
function checkbox(item: TodoItem): string {
	if (item.status === "done") return "[x]";
	if (item.status === "in_progress") return "[~]";
	return "[ ]";
}

function line(item: TodoItem): string {
	return `- ${checkbox(item)} ${item.title}`;
}

/**
 * Render `plan` as markdown under a `# TODO — <title>` heading with a `Progress: done/total` line. Named
 * groups (tasks) become `## <title> — n/m` sections in order (the same done/total badge the popup
 * shows); the loose (user) items follow — under an `### Other` heading only when groups exist, else
 * listed directly. Trailing newline so it reads clean in the rendered view.
 */
export function planToMarkdown(plan: TodoPlan, title: string): string {
	const all = flatItems(plan);
	const done = all.filter((t) => t.status === "done").length;
	const lines: string[] = [`# TODO — ${title}`, "", `Progress: ${done}/${all.length}`];

	for (const group of plan.groups) {
		const progress = groupProgress(group);
		lines.push(
			"",
			`## ${group.title} — ${progress.done}/${progress.total}`,
			...group.todos.map(line),
		);
	}
	if (plan.todos.length > 0) {
		lines.push("", ...(plan.groups.length > 0 ? ["### Other"] : []), ...plan.todos.map(line));
	}
	if (all.length === 0) lines.push("", "_No items yet._");

	return `${lines.join("\n")}\n`;
}
