// Presentation-side derivations for blog posts, shared by the index cards, post pages, and RSS.

const WORDS_PER_MINUTE = 200;

/** Publication date in the blog's display format, pinned to UTC so it never shifts per timezone. */
export function formatPostDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

/** Estimated minutes to read a Markdown body: prose words only, code/links/markup stripped. */
export function readingTimeMinutes(markdown: string): number {
	const text = markdown
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/[#*_~>-]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
	return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
