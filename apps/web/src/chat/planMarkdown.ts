import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { buildDiffHref } from "./diffHref";
import { flatItems, groupProgress, itemChangeSet } from "./planView";

// Compile a chat's TODO plan to a temporary, human-readable markdown snapshot (SPEC §Chat TODO plan) — the
// "Open as markdown" action in the plan popup. Pure + presentational-adjacent (no store/transport): it
// just maps the plan to GFM. Structure mirrors the plan's own shape — named groups as `##` sections, the
// loose items last — with a progress header and GFM task-list checkboxes. A done item that produced a
// change set becomes a **review map**: its short commit sha inline, and each changed file a diff-scheme
// link the doc viewer opens as a diff tab (commit scope when the item was committed, else branch scope).

/** GFM task-list box for a status: done `[x]`, pending `[ ]`, in-progress `[~]` (a distinct middle mark). */
function checkbox(item: TodoItem): string {
	if (item.status === "done") return "[x]";
	if (item.status === "in_progress") return "[~]";
	return "[ ]";
}

/**
 * One item as markdown lines: the checkbox row, then — for a done item carrying a change set
 * (`itemChangeSet`, the shared derivation) — its short commit sha (when committed) and a nested list of
 * its changed files, each a diff-scheme deep link. The sha on the link picks the diff scope: the item's
 * `commit` sha (durable done-time diff) or branch (the path-list fallback).
 */
function itemLines(item: TodoItem): string[] {
	const head = `- ${checkbox(item)} ${item.title}`;
	const set = itemChangeSet(item);
	if (!set) return [head];
	if (set.kind === "commit") {
		return [
			`${head} \`${set.sha.slice(0, 7)}\``,
			...set.files.map((path) => `    - [${path}](${buildDiffHref(set.sha, path)})`),
		];
	}
	return [head, ...set.paths.map((path) => `    - [${path}](${buildDiffHref(null, path)})`)];
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
			...group.todos.flatMap(itemLines),
		);
	}
	if (plan.todos.length > 0) {
		lines.push(
			"",
			...(plan.groups.length > 0 ? ["### Other"] : []),
			...plan.todos.flatMap(itemLines),
		);
	}
	if (all.length === 0) lines.push("", "_No items yet._");

	return `${lines.join("\n")}\n`;
}
