import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and de-dupe conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** True for a markdown file path (`.md` / `.markdown`, case-insensitive) — the rendered-preview gate. */
export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

/**
 * Drop a leading YAML frontmatter block (a `---` line, its body, and a closing `---`/`...` line) so the
 * rendered markdown view doesn't turn spec metadata into a stray heading — the conventional behavior for
 * rendered markdown (source view still shows it). No frontmatter → returned unchanged.
 */
export function stripFrontmatter(text: string): string {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	return match ? text.slice(match[0].length) : text;
}
