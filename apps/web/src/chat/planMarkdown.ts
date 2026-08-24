import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { changeSetStat, flatItems, groupProgress, itemChangeSet, statusLetter } from "./planView";

function checkbox(item: TodoItem): string {
	if (item.status === "done") return "[x]";
	if (item.status === "in_progress") return "[~]";
	return "[ ]";
}

function plusMinus(added: number, removed: number): string {
	const parts = [...(added > 0 ? [`+${added}`] : []), ...(removed > 0 ? [`−${removed}`] : [])];
	return parts.join(" ");
}

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
