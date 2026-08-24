const WORDS_PER_MINUTE = 200;

export function formatPostDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

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
