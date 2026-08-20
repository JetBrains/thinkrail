import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { changeSetStat, flatItems, groupProgress, itemChangeSet, statusLetter } from "./planView";

// Compile a chat's TODO plan to a human-readable markdown report (SPEC §Chat TODO plan) — the plan
// page's **export** (copy / save-as-.md). Pure + presentational-adjacent (no store/transport): it just
// maps the plan to GFM. Structure mirrors the plan's own shape — named groups as `##` sections, the
// loose items last — with a progress header and GFM task-list checkboxes. A done item that produced a
// change set reads as a **review map**: its short commit sha + `N files · +A −R` inline, and each
// changed file a status-lettered row with its own `+/−`. Plain text throughout — the export leaves the
// app, so links would be dead; interactive navigation lives on the plan page itself (`panels/PlanPane`).

/** GFM task-list box for a status: done `[x]`, pending `[ ]`, in-progress `[~]` (a distinct middle mark). */
function checkbox(item: TodoItem): string {
	if (item.status === "done") return "[x]";
	if (item.status === "in_progress") return "[~]";
	return "[ ]";
}

/** `+A −R` (either side omitted at 0; empty when neither) — the textual twin of the UI's DiffStatBadge. */
function plusMinus(added: number, removed: number): string {
	const parts = [...(added > 0 ? [`+${added}`] : []), ...(removed > 0 ? [`−${removed}`] : [])];
	return parts.join(" ");
}

/**
 * One item as markdown lines: the checkbox row, then — for a done item carrying a change set
 * (`itemChangeSet`, the shared derivation) — its short commit sha + `N files · +A −R` summary and a
 * nested status-lettered file list with per-file counts. The path-list fallback lists bare paths (its
 * diff is live, so counts would drift). Plain text — this is an export, not the interactive page.
 */
function itemLines(item: TodoItem): string[] {
	const head = `- ${checkbox(item)} ${item.title}`;
	const set = itemChangeSet(item);
	if (!set) return [head];
	if (set.kind === "paths") {
		return [head, ...set.paths.map((path) => `    - ${path}`)];
	}
	const { count, added, removed } = changeSetStat(set.files);
	const stat = plusMinus(added, removed);
	const countText = `${count} ${count === 1 ? "file" : "files"}`;
	const summary = [`\`${set.sha.slice(0, 7)}\``, countText, ...(stat ? [stat] : [])].join(" · ");
	return [
		`${head} — ${summary}`,
		...set.files.map((f) => {
			const fileStat = plusMinus(f.added ?? 0, f.removed ?? 0);
			return `    - \`${statusLetter(f.status)}\` ${f.path}${fileStat ? ` · ${fileStat}` : ""}`;
		}),
	];
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
