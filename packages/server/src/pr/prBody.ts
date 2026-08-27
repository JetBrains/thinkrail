import type { TodoItem, TodoPlan } from "@thinkrail/contracts";

function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.groups.flatMap((g) => g.todos), ...plan.todos];
}

function latestCommitSha(item: TodoItem): string | undefined {
	const commits = (item.artifacts ?? []).filter((a) => a.kind === "commit" && a.sha);
	return commits[commits.length - 1]?.sha;
}

function reviewSettled(item: TodoItem): boolean {
	const r = item.review;
	return r !== undefined && r.state === "reviewed" && (r.unreviewedShas?.length ?? 0) === 0;
}

function itemLines(item: TodoItem): string[] {
	const box = item.status === "done" ? "x" : " ";
	const sha = latestCommitSha(item);
	const lines = [`- [${box}] **${item.title}**${sha ? ` (\`${sha.slice(0, 7)}\`)` : ""}`];
	if (item.summary) lines.push(`  ${item.summary}`);
	if (item.verification) lines.push(`  Verified: ${item.verification}`);
	return lines;
}

export function renderPrBody(plan: TodoPlan): string {
	const items = flatItems(plan);
	const lines: string[] = [];
	if (plan.summary) lines.push(plan.summary, "");
	if (items.length > 0) {
		lines.push("## Plan");
		for (const group of plan.groups) {
			lines.push(`### ${group.title}`);
			for (const item of group.todos) lines.push(...itemLines(item));
		}
		if (plan.todos.length > 0) {
			if (plan.groups.length > 0) lines.push("### Other");
			for (const item of plan.todos) lines.push(...itemLines(item));
		}
		const reviewable = items.filter((t) => t.review !== undefined);
		if (reviewable.length > 0) {
			const settled = reviewable.filter(reviewSettled).length;
			lines.push("", `Review: ${settled}/${reviewable.length} steps reviewed in ThinkRail.`);
		}
	}
	return lines.join("\n").trim();
}
