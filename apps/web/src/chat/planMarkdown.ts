import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import {
	changeSetStat,
	flatItems,
	groupProgress,
	itemChangeSet,
	planChangeTotals,
	planCompletionSummary,
	reviewableItems,
	reviewSettled,
	statusLetter,
} from "./planView";

function checkbox(item: TodoItem): string {
	if (item.status === "done") return "[x]";
	if (item.status === "in_progress") return "[~]";
	return "[ ]";
}

function plusMinus(added: number, removed: number): string {
	const parts = [...(added > 0 ? [`+${added}`] : []), ...(removed > 0 ? [`−${removed}`] : [])];
	return parts.join(" ");
}

// Collapse a possibly-multiline (Markdown bullet) field into one export line so the nested list stays
// valid: strip leading bullet markers, drop blank lines, join with " · ".
function flattenInline(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
		.filter(Boolean)
		.join(" · ");
}

function itemLines(item: TodoItem): string[] {
	const head = `- ${checkbox(item)} ${item.title}`;
	const summary = [
		...(item.status === "done" && item.summary ? [`    - _${flattenInline(item.summary)}_`] : []),
		...(item.status === "done" && item.verification
			? [`    - Verified: ${flattenInline(item.verification)}`]
			: []),
	];
	const set = itemChangeSet(item);
	if (!set) return [head, ...summary];
	if (set.kind === "paths") {
		return [head, ...summary, ...set.paths.map((path) => `    - ${path}`)];
	}
	const { count, added, removed } = changeSetStat(set.files);
	const stat = plusMinus(added, removed);
	const countText = `${count} ${count === 1 ? "file" : "files"}`;
	const statLine = [`\`${set.sha.slice(0, 7)}\``, countText, ...(stat ? [stat] : [])].join(" · ");
	return [
		`${head} — ${statLine}`,
		...summary,
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
	if (all.length > 0 && done === all.length) {
		const reviewables = reviewableItems(plan);
		const reviewed = reviewables.filter(reviewSettled).length;
		const files = planChangeTotals(plan).files;
		const overall = planCompletionSummary(plan);
		// Only worth a section when it adds something over the Progress line above.
		if (overall || files > 0 || reviewables.length > 0) {
			const facts = [`${done} ${done === 1 ? "step" : "steps"} done`];
			if (files > 0) facts.push(`${files} ${files === 1 ? "file" : "files"}`);
			if (reviewables.length > 0) facts.push(`${reviewed}/${reviewables.length} reviewed`);
			lines.push("", "## Summary", "", facts.join(" · "), ...(overall ? ["", overall] : []));
		}
	}

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
	const adopted = plan.adoptedCommits ?? [];
	const unattributed = plan.unattributed ?? [];
	if (all.length === 0 && adopted.length === 0 && unattributed.length === 0) {
		lines.push("", "_No items yet._");
	}

	if (adopted.length > 0) {
		lines.push("", "## Committed outside the plan", ...adopted.flatMap(itemLines));
	}

	if (unattributed.length > 0) {
		lines.push(
			"",
			"## Outside the plan",
			...unattributed.map((f) => {
				const fileStat = plusMinus(f.added ?? 0, f.removed ?? 0);
				return `- \`${statusLetter(f.status)}\` ${f.path}${fileStat ? ` · ${fileStat}` : ""}`;
			}),
		);
	}

	return `${lines.join("\n")}\n`;
}
