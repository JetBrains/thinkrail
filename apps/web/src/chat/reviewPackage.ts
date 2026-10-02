import type { ReviewFixComment } from "@thinkrail/contracts";

export interface ReviewPackageItem {
	path: string | null;
	lineRef: string;
	fragment: string | null;
	locator: string | null;
	body: string;
}

export interface ReviewPackageSummary {
	count: number;
	files: string[];
	items: ReviewPackageItem[];
}

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#13;": "\r",
	"&#10;": "\n",
};

function decodeValue(value: string): string {
	return value.replace(/&(?:amp|lt|gt|quot|#13|#10);/g, (entity) => ENTITIES[entity] ?? entity);
}

function attrOf(attrs: string, name: string): string | null {
	const value = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
	return value === undefined ? null : decodeValue(value);
}

function locatorOf(block: string): string | null {
	const lines = [...block.matchAll(/^<locator>([^\n]*)<\/locator>$/gm)].map(([, value = ""]) =>
		decodeValue(value),
	);
	return lines.length === 0 ? null : lines.join("\n");
}

function lineRefOf(lines: string | null): string {
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
		const path = attrOf(attrs, "path");
		if (path && !files.includes(path)) files.push(path);
		items.push({
			path,
			lineRef: lineRefOf(attrOf(attrs, "lines")),
			fragment: blockOf("fragment", block),
			locator: locatorOf(block),
			body: blockOf("text", block) ?? "",
		});
	}
	return { count: comments.length, files, items };
}

function reviewFixLineRef(c: ReviewFixComment): string {
	const loc =
		c.startLine === undefined
			? ""
			: c.endLine === undefined || c.endLine === c.startLine
				? `L${c.startLine}`
				: `L${c.startLine}–${c.endLine}`;
	if (c.path && loc) return `${c.path} ${loc}`;
	return c.path ?? loc;
}

export function reviewFixCommentsToItems(comments: ReviewFixComment[]): ReviewPackageItem[] {
	return comments.map((c) => ({
		path: c.path ?? null,
		lineRef: reviewFixLineRef(c),
		fragment: null,
		locator: null,
		body: c.body,
	}));
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
