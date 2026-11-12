import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
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

function itemLines(t: Translator, item: TodoItem): string[] {
	const head = `- ${checkbox(item)} ${item.title}`;
	const summary = [
		...(item.status === "done" && item.summary ? [`    - _${flattenInline(item.summary)}_`] : []),
		...(item.status === "done" && item.verification
			? [
					`    - ${t("chat.planExport.verified", { verification: flattenInline(item.verification) })}`,
				]
			: []),
	];
	const set = itemChangeSet(item);
	if (!set) return [head, ...summary];
	if (set.kind === "paths") {
		return [head, ...summary, ...set.paths.map((path) => `    - ${path}`)];
	}
	const { count, added, removed } = changeSetStat(set.files);
	const stat = plusMinus(added, removed);
	const countText = t("chat.planExport.files", { count });
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

export function planToMarkdown(t: Translator, plan: TodoPlan, title: string): string {
	const all = flatItems(plan);
	const done = all.filter((t) => t.status === "done").length;
	const lines: string[] = [
		`# ${t("chat.planExport.title", { title })}`,
		"",
		t("chat.planExport.progress", { done, total: all.length }),
	];
	if (all.length > 0 && done === all.length) {
		const reviewables = reviewableItems(plan);
		const reviewed = reviewables.filter(reviewSettled).length;
		const files = planChangeTotals(plan).files;
		const overall = planCompletionSummary(plan);
		// Only worth a section when it adds something over the Progress line above.
		if (overall || files > 0 || reviewables.length > 0) {
			const facts = [t("chat.planExport.stepsDone", { count: done })];
			if (files > 0) facts.push(t("chat.planExport.files", { count: files }));
			if (reviewables.length > 0) {
				facts.push(t("chat.planExport.reviewed", { reviewed, total: reviewables.length }));
			}
			lines.push(
				"",
				`## ${t("chat.planExport.summary")}`,
				"",
				facts.join(" · "),
				...(overall ? ["", overall] : []),
			);
		}
	}

	for (const group of plan.groups) {
		const progress = groupProgress(group);
		lines.push(
			"",
			`## ${group.title} — ${progress.done}/${progress.total}`,
			...group.todos.flatMap((item) => itemLines(t, item)),
		);
	}
	if (plan.todos.length > 0) {
		lines.push(
			"",
			...(plan.groups.length > 0 ? [`### ${t("chat.planExport.other")}`] : []),
			...plan.todos.flatMap((item) => itemLines(t, item)),
		);
	}
	const adopted = plan.adoptedCommits ?? [];
	const unattributed = plan.unattributed ?? [];
	if (all.length === 0 && adopted.length === 0 && unattributed.length === 0) {
		lines.push("", `_${t("chat.planExport.empty")}_`);
	}

	if (adopted.length > 0) {
		lines.push(
			"",
			`## ${t("chat.planExport.committedOutside")}`,
			...adopted.flatMap((item) => itemLines(t, item)),
		);
	}

	if (unattributed.length > 0) {
		lines.push(
			"",
			`## ${t("chat.planExport.outside")}`,
			...unattributed.map((f) => {
				const fileStat = plusMinus(f.added ?? 0, f.removed ?? 0);
				return `- \`${statusLetter(f.status)}\` ${f.path}${fileStat ? ` · ${fileStat}` : ""}`;
			}),
		);
	}

	return `${lines.join("\n")}\n`;
}
