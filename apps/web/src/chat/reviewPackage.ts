export interface ReviewPackageItem {
	path: string | null;
	lineRef: string;
	fragment: string | null;
	body: string;
}

export interface ReviewPackageSummary {
	count: number;
	files: string[];
	items: ReviewPackageItem[];
}

function lineRefOf(lines: string | undefined): string {
	const m = lines ? /^(\d+)-(\d+)$/.exec(lines) : null;
	if (!m) return "";
	return m[1] === m[2] ? `L${m[1]}` : `L${m[1]}–${m[2]}`;
}

function blockOf(tag: string, block: string): string | null {
	const m = new RegExp(`^<${tag}[^\\n]*>\\n([\\s\\S]*?)\\n</${tag}>$`, "m").exec(block);
	return m?.[1] ?? null;
}

export function parseReviewPackage(text: string): ReviewPackageSummary | null {
	if (!/^<review id="[^"]+" branch="[^"]*" base="[^"]*" comments="\d+">$/m.test(text)) return null;
	const comments = [
		...text.matchAll(/^<comment (id="[^"]+" kind="[^"]+"[^\n]*)>$\n([\s\S]*?)^<\/comment>$/gm),
	];
	if (comments.length === 0) return null;
	const files: string[] = [];
	const items: ReviewPackageItem[] = [];
	for (const [, attrs = "", block = ""] of comments) {
		const path = /\spath="([^"]+)"/.exec(attrs)?.[1] ?? null;
		if (path && !files.includes(path)) files.push(path);
		items.push({
			path,
			lineRef: lineRefOf(/\slines="([^"]+)"/.exec(attrs)?.[1]),
			fragment: blockOf("fragment", block),
			body: blockOf("text", block) ?? "",
		});
	}
	return { count: comments.length, files, items };
}

export function reviewPackageLabel(summary: Pick<ReviewPackageSummary, "count" | "files">): string {
	const noun = summary.count === 1 ? "review comment" : "review comments";
	const where =
		summary.files.length === 0
			? "the change set"
			: summary.files.length === 1
				? summary.files[0]
				: `${summary.files.length} files`;
	return `Sent ${summary.count} ${noun} on ${where}`;
}
